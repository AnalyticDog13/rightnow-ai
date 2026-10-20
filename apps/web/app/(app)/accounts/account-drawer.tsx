"use client";

import type { ApiAccount } from "@rightnow/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call, errorText } from "./api-client";
import { ConnectMenu, type Provider } from "./connect-menu";
import { isNumeric } from "./numeric";

type Kind = "text" | "number" | "minutes" | "nullable";
// Gaps are stored in seconds and shown in minutes (PS-ACC-13).
const FIELDS: { k: keyof ApiAccount; label: string; kind: Kind }[] = [
  { k: "fromName", label: "From name", kind: "text" },
  { k: "firstName", label: "First name", kind: "text" },
  { k: "lastName", label: "Last name", kind: "text" },
  { k: "replyTo", label: "Reply-to address", kind: "nullable" },
  { k: "timezone", label: "Timezone", kind: "text" },
  { k: "dailyLimit", label: "Daily limit", kind: "number" },
  { k: "providerCap", label: "Provider daily cap", kind: "number" },
  { k: "minGapSec", label: "Minimum gap (minutes)", kind: "minutes" },
  { k: "randomGapSec", label: "Random extra gap (minutes)", kind: "minutes" },
  { k: "historyImportDays", label: "History import (days)", kind: "number" },
  { k: "rampStartVolume", label: "Ramp start volume", kind: "number" },
  { k: "rampIncrementPerDay", label: "Ramp increase per day", kind: "number" },
  { k: "trackingDomain", label: "Tracking domain", kind: "nullable" },
];
const BOOLS: { k: keyof ApiAccount; label: string }[] = [
  { k: "slowRamp", label: "Slow ramp-up" },
  { k: "appendToSent", label: "Save sent mail in the Sent folder" },
];
const REASON: Record<string, string> = {
  provider_cap: "half of the provider's daily cap",
  tier_max: "the highest cap this account type allows",
  provider_min_gap: "the provider's minimum gap",
};
const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.k, f.label]));

const show = (a: ApiAccount, f: (typeof FIELDS)[number]) => {
  const v = a[f.k] as string | number | null;
  return v === null ? "" : f.kind === "minutes" ? String((v as number) / 60) : String(v);
};
const toForm = (a: ApiAccount) => ({
  ...Object.fromEntries(FIELDS.map((f) => [f.k, show(a, f)])),
  signature: a.signature ?? "",
  tags: a.tags.join(", "),
  slowRamp: a.slowRamp,
  appendToSent: a.appendToSent,
});
type Form = ReturnType<typeof toForm>;

export function AccountDrawer({
  account,
  canEdit,
  isAdmin,
  configured,
  onClose,
  onChanged,
}: {
  account: ApiAccount;
  canEdit: boolean;
  isAdmin: boolean;
  configured: Record<Provider, boolean>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [init, setInit] = useState<Form>(() => toForm(account));
  const [form, setForm] = useState<Form>(init);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testOk, setTestOk] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [checks, setChecks] = useState<{ name: string; ok: boolean; code?: string }[]>([]);

  useEffect(() => {
    dialog.current?.showModal(); // Escape closes it natively and fires `close`
  }, []);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const v = form[f.k as keyof Form] as string;
      if (v === init[f.k as keyof Form]) continue;
      if ((f.kind === "number" || f.kind === "minutes") && !isNumeric(v))
        return setError(`${f.label}: enter a number.`);
      patch[f.k] =
        f.kind === "nullable"
          ? v.trim() === ""
            ? null
            : v.trim()
          : f.kind === "text"
            ? v
            : f.kind === "minutes"
              ? Math.round(Number(v) * 60)
              : Number(v);
    }
    if (form.signature !== init.signature)
      patch.signature = form.signature === "" ? null : form.signature;
    if (form.tags !== init.tags)
      patch.tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    for (const b of BOOLS)
      if (form[b.k as "slowRamp"] !== init[b.k as "slowRamp"]) patch[b.k] = form[b.k as "slowRamp"];
    if (Object.keys(patch).length === 0) return setNotes(["Nothing changed."]);
    const r = await call(`/api/v1/accounts/${account.id}`, "PATCH", patch);
    if (!r.ok) {
      setError(errorText(r));
      return setNotes([]);
    }
    setError("");
    const saved = r.json.account as ApiAccount;
    const next = toForm(saved);
    setInit(next);
    setForm(next);
    const warnings = r.json.warnings as { field: string; clampedTo: number; reason: string }[];
    setNotes(
      warnings.length
        ? warnings.map(
            (w) =>
              `${FIELD_LABEL[w.field] ?? w.field} was set to ${w.field === "minGapSec" ? `${w.clampedTo / 60} min` : w.clampedTo}, ${REASON[w.reason] ?? w.reason}.`,
          )
        : ["Saved."],
    );
    onChanged();
  }

  async function diagnose() {
    const r = await call(`/api/v1/accounts/${account.id}/diagnostics`, "POST", {});
    setChecks((r.json.checks as typeof checks) ?? []);
    setError(r.ok ? "" : errorText(r));
    onChanged();
  }
  async function markFixed() {
    const r = await call(`/api/v1/accounts/${account.id}/mark-fixed`, "POST", {});
    setChecks((r.json.checks as typeof checks) ?? []);
    setError(r.ok ? "" : errorText(r));
    onChanged();
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    setTestMsg("Sending...");
    const r = await call(`/api/v1/accounts/${account.id}/test-send`, "POST", {
      to: testTo,
      confirmAuthorized: testOk,
    });
    setTestMsg(r.ok ? "Test email sent." : errorText(r));
    if (r.ok) onChanged();
  }

  const broken = account.status !== "CONNECTED" || account.lifecycle === "NEEDS_ATTENTION";
  return (
    <dialog
      ref={dialog}
      aria-labelledby="drawer-title"
      onClose={onClose}
      className="m-auto w-full max-w-2xl rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/40"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="drawer-title" className="text-lg font-semibold">
          {account.email}
        </h2>
        <Button variant="outline" onClick={() => dialog.current?.close()}>
          Close
        </Button>
      </div>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.k} className="flex flex-col gap-1">
            <Label htmlFor={`f-${f.k}`}>{f.label}</Label>
            <Input
              id={`f-${f.k}`}
              type={f.kind === "number" || f.kind === "minutes" ? "number" : "text"}
              step={f.kind === "minutes" ? "any" : undefined}
              min={f.kind === "number" || f.kind === "minutes" ? 0 : undefined}
              disabled={!canEdit}
              value={form[f.k as keyof Form] as string}
              onChange={(e) => set(f.k, e.target.value)}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="f-tags">Tags (comma separated)</Label>
          <Input
            id="f-tags"
            disabled={!canEdit}
            value={form.tags}
            onChange={(e) => set("tags", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="f-signature">Signature</Label>
          <textarea
            id="f-signature"
            rows={4}
            disabled={!canEdit}
            className="rounded-md border border-border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
            value={form.signature}
            onChange={(e) => set("signature", e.target.value)}
          />
        </div>
        {BOOLS.map((b) => (
          <label key={b.k} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={form[b.k as "slowRamp"]}
              onChange={(e) => set(b.k, e.target.checked)}
            />
            {b.label}
          </label>
        ))}
        {canEdit && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit">Save</Button>
            <p role="status" className="text-sm">
              {notes.join(" ")}
            </p>
          </div>
        )}
      </form>
      <p role="alert" className="min-h-5 text-sm text-destructive">
        {error}
      </p>
      {canEdit && (
        <section
          aria-label="Connection"
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={diagnose}>
              Run diagnostics
            </Button>
            {broken && (
              <Button variant="outline" onClick={markFixed}>
                Mark as fixed
              </Button>
            )}
          </div>
          {checks.length > 0 && (
            <ul className="text-sm">
              {checks.map((c) => (
                <li key={c.name}>
                  {c.name}: {c.ok ? "ok" : `failed${c.code ? ` (${c.code})` : ""}`}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <form onSubmit={sendTest} aria-label="Send test email" className="flex flex-col gap-2">
              <Label htmlFor="test-to">Send test email to</Label>
              <Input
                id="test-to"
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={testOk}
                  onChange={(e) => setTestOk(e.target.checked)}
                />
                I am authorized to send from this account
              </label>
              <div className="flex items-center gap-3">
                <Button type="submit" variant="outline" disabled={!testOk || !testTo.trim()}>
                  Send test email
                </Button>
                <p aria-live="polite" className="text-sm">
                  {testMsg}
                </p>
              </div>
            </form>
          )}
          {isAdmin && account.provider !== "SMTP" && (
            <ConnectMenu
              configured={configured}
              reconnect={{
                id: account.id,
                provider: account.provider === "GMAIL" ? "google" : "microsoft",
              }}
            />
          )}
        </section>
      )}
    </dialog>
  );
}
