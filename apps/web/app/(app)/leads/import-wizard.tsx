"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { Named } from "./bulk-bar";

const FIELDS: [string, string][] = [
  ["email", "Email"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["companyName", "Company"],
  ["jobTitle", "Job title"],
  ["website", "Website"],
  ["phone", "Phone"],
];
const BASES = [
  ["legitimate_interest", "Legitimate interest"],
  ["consent", "Consent"],
  ["contract", "Contract"],
  ["other", "Other"],
];
const SKIP: Record<string, string> = {
  missing_email: "Missing email",
  invalid_email: "Invalid email",
  disposable: "Disposable domain",
  duplicate_in_file: "Duplicate in file",
  blocklisted: "Blocklisted",
  exists_in_workspace: "Already in workspace",
  exists_in_list: "Already in list",
};
type Counts = {
  rows: number;
  missingEmail: number;
  invalidEmail: number;
  duplicateInFile: number;
  existsInWorkspace: number;
};
type Preview = { headers: string[]; mapping: (string | null)[]; counts: Counts; sampled: boolean };
type Job = {
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  progress: number;
  imported: number;
  attached: number;
  skipped: Record<string, number>;
  error: string | null;
};
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

async function send(url: string, file: File, fields: Record<string, unknown>) {
  const fd = new FormData();
  fd.set("file", file);
  for (const [k, v] of Object.entries(fields)) fd.set(k, JSON.stringify(v));
  const res = await fetch(url, { method: "POST", body: fd }).catch(() => null);
  const json = (await res?.json().catch(() => ({}))) as Record<string, unknown> | undefined;
  return { ok: !!res?.ok, json: json ?? {} };
}
const err = (j: Record<string, unknown>) =>
  typeof j.error === "string" ? j.error : "Something went wrong";

export function ImportWizard({ lists, onDone }: { lists: Named[]; onDone: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [pre, setPre] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [listId, setListId] = useState("");
  const [skipWs, setSkipWs] = useState(true);
  const [skipList, setSkipList] = useState(false);
  const [source, setSource] = useState("");
  const [basis, setBasis] = useState("legitimate_interest");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  function reset() {
    setStep(1);
    setFile(null);
    setPre(null);
    setAuthorized(false);
    setError("");
    setJobId("");
    setJob(null);
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setError("");
    setBusy(true);
    const r = await send("/api/v1/imports/preview", f, {});
    setBusy(false);
    if (!r.ok) return setError(err(r.json));
    const p = r.json as unknown as Preview;
    setPre(p);
    setMapping(p.mapping);
  }

  async function toOptions() {
    setBusy(true);
    const r = await send("/api/v1/imports/preview", file!, { mapping });
    setBusy(false);
    if (!r.ok) return setError(err(r.json));
    setError("");
    setPre(r.json as unknown as Preview);
    setStep(3);
  }

  async function run() {
    setBusy(true);
    const r = await send("/api/v1/imports", file!, {
      options: {
        mapping,
        options: { ...(listId && { listId }), skipIfInWorkspace: skipWs, skipIfInList: skipList },
        confirmedAuthorized: authorized,
        lawfulBasis: basis,
        ...(source.trim() && { source: source.trim() }),
      },
    });
    setBusy(false);
    if (!r.ok) return setError(err(r.json));
    setError("");
    setJobId(r.json.importJobId as string);
    setStep(4);
  }

  useEffect(() => {
    if (!jobId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const res = await fetch(`/api/v1/imports/${jobId}`).catch(() => null);
      const j = (await res?.json().catch(() => null)) as Job | null;
      if (!live) return;
      if (j) setJob(j);
      if (j && (j.status === "DONE" || j.status === "FAILED")) return done.current();
      timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  const c = pre?.counts;
  const count = (label: string, n: number | undefined) => (
    <li key={label}>
      {label}: {n ?? 0}
    </li>
  );
  const finished = job?.status === "DONE" || job?.status === "FAILED";

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          dialog.current?.showModal();
        }}
      >
        Import CSV
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="import-title"
        className="m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/40"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="import-title" className="text-lg font-semibold">
            Import leads
          </h2>
          <Button variant="outline" onClick={() => dialog.current?.close()}>
            Close
          </Button>
        </div>

        {step === 1 && (
          <section className="flex flex-col gap-3">
            <h3 className="font-medium">Step 1 of 4: Upload a CSV</h3>
            <Label htmlFor="import-file">CSV file (comma, semicolon, tab or pipe separated)</Label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            {pre && (
              <p role="status">
                {c?.rows} rows found in {file?.name}.
              </p>
            )}
            <div>
              <Button disabled={!pre || busy} onClick={() => setStep(2)}>
                Next
              </Button>
            </div>
          </section>
        )}

        {step === 2 && pre && (
          <section className="flex flex-col gap-3">
            <h3 className="font-medium">Step 2 of 4: Map columns</h3>
            {pre.headers.map((h, i) => (
              <div key={i} className="flex items-center gap-3">
                <Label htmlFor={`map-${i}`} className="w-48 truncate">
                  {h}
                </Label>
                <span aria-hidden>→</span>
                <select
                  id={`map-${i}`}
                  className={sel}
                  value={mapping[i] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => m.map((x, j) => (j === i ? e.target.value || null : x)))
                  }
                >
                  <option value="">Ignore this column</option>
                  {FIELDS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                  <option value={`custom:${h}`}>Custom field “{h}”</option>
                </select>
              </div>
            ))}
            {!mapping.includes("email") && (
              <p role="alert" className="text-sm text-destructive">
                Map one column to Email.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button disabled={busy || !mapping.includes("email")} onClick={toOptions}>
                Next
              </Button>
            </div>
          </section>
        )}

        {step === 3 && pre && (
          <section className="flex flex-col gap-3">
            <h3 className="font-medium">Step 3 of 4: Options and preview</h3>
            <div>
              <h4 className="text-sm font-medium">
                Preview{pre.sampled ? " (first 1000 rows)" : ""}
              </h4>
              <ul className="text-sm">
                {count("Rows", c?.rows)}
                {count("Missing email", c?.missingEmail)}
                {count("Invalid email", c?.invalidEmail)}
                {count("Duplicate in file", c?.duplicateInFile)}
                {count("Already in workspace", c?.existsInWorkspace)}
              </ul>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="import-list">Add to list</Label>
              <select
                id="import-list"
                className={sel}
                value={listId}
                onChange={(e) => setListId(e.target.value)}
              >
                <option value="">No list</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={skipWs}
                onChange={(e) => setSkipWs(e.target.checked)}
              />
              Skip leads that already exist in the workspace
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={skipList}
                disabled={!listId}
                onChange={(e) => setSkipList(e.target.checked)}
              />
              Skip leads already in the chosen list
            </label>
            <div className="flex flex-col gap-1">
              <Label htmlFor="import-source">Source (optional)</Label>
              <Input
                id="import-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="import-basis">Lawful basis</Label>
              <select
                id="import-basis"
                className={sel}
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
              >
                {BASES.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                required
                checked={authorized}
                onChange={(e) => setAuthorized(e.target.checked)}
              />
              I am authorized to email these contacts
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button disabled={!authorized || busy} onClick={run}>
                Run import
              </Button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="flex flex-col gap-3" aria-live="polite">
            <h3 className="font-medium">Step 4 of 4: Import</h3>
            {!finished && (
              <>
                <progress
                  aria-label="Import progress"
                  max={100}
                  value={job?.progress ?? 0}
                  className="w-full"
                />
                <p role="status">
                  {job?.status === "RUNNING"
                    ? `Importing… ${job.progress}%`
                    : "Waiting for the worker to start the import…"}
                </p>
              </>
            )}
            {job?.status === "FAILED" && (
              <p role="alert" className="text-destructive">
                Import failed: {job.error}
              </p>
            )}
            {job?.status === "DONE" && (
              <ul role="status" aria-label="Import result" className="text-sm">
                <li>Imported {job.imported}</li>
                {job.attached > 0 && <li>Added to list {job.attached}</li>}
                {Object.entries(job.skipped).map(([k, n]) => (
                  <li key={k}>
                    {SKIP[k] ?? k} {n}
                  </li>
                ))}
              </ul>
            )}
            {finished && (
              <div>
                <Button onClick={() => dialog.current?.close()}>Done</Button>
              </div>
            )}
          </section>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </dialog>
    </>
  );
}
