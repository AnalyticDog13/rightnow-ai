"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "../../../components/tabs";
import {
  BulkToolbar,
  NextPage,
  SortTh,
  useSelection,
  useSort,
} from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Card } from "../../../components/ui/card";
import { call, errorText } from "../accounts/api-client";

type Row = {
  id: string;
  status: string;
  dueAt: string;
  sentAt: string | null;
  error: string | null;
  renderedSubject: string;
  uncertainAt: string | null;
  searchCount: number;
  lastSearchAt: string | null;
  accountEmail: string;
  leadEmail: string;
};
// Tab id = the API status filter; "Failed" is the dead-letter view: FAILED and HELD rows with their error.
// UNCERTAIN is what the sender could not confirm: shown to people as "Outcome unknown".
const TABS = [
  { id: "SCHEDULED", label: "Scheduled" },
  { id: "HELD", label: "Held" },
  { id: "DEAD_LETTER", label: "Failed" },
  { id: "UNCERTAIN", label: "Outcome unknown" },
  { id: "CANCELLED", label: "Cancelled" },
];
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

export function ScheduledView({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const [tab, setTab] = useState("SCHEDULED");
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [release, setRelease] = useState<Row | null>(null);
  const [q, setQ] = useState("");
  const sel = useSelection();
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        !needle ||
        [r.leadEmail, r.accountEmail, r.renderedSubject].some((v) =>
          v.toLowerCase().includes(needle),
        ),
    );
  }, [rows, q]);
  const {
    sorted,
    sort,
    toggle: sortBy,
  } = useSort(shown, {
    lead: (r) => r.leadEmail.toLowerCase(),
    account: (r) => r.accountEmail.toLowerCase(),
    subject: (r) => r.renderedSubject.toLowerCase(),
    due: (r) => r.sentAt ?? r.dueAt,
  });
  const ids = sorted.map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((id) => sel.selected.has(id));
  // "Cancel" and "Retry" only apply to some states; a bulk call over the chosen rows skips the others
  const verbFor = (r: Row, verb: "cancel" | "retry") =>
    verb === "cancel" ? r.status === "HELD" || r.status === "SCHEDULED" : r.status === "FAILED";

  const current = useRef(tab); // the tab being shown; a slower response for an earlier tab is dropped
  current.current = tab;
  const load = useCallback(
    async (cursor?: string) => {
      const q = new URLSearchParams({ status: tab, take: "50" });
      if (cursor) q.set("cursor", cursor);
      const r = await call(`/api/v1/scheduled-messages?${q}`, "GET");
      if (current.current !== tab) return;
      if (!r.ok) return setMsg(errorText(r));
      const got = (r.json.rows ?? []) as Row[];
      setRows((o) => (cursor ? [...o, ...got] : got));
      setNext((r.json.nextCursor as string | null) ?? null);
      setLoaded(true);
    },
    [tab],
  );
  useEffect(() => {
    setLoaded(false);
    setRows([]);
    setMsg("");
    sel.clear();
    void load();
  }, [load]);

  async function act(row: Row, verb: "cancel" | "retry" | "release") {
    const r = await call(
      `/api/v1/scheduled-messages/${row.id}/${verb}`,
      "POST",
      verb === "release" ? { confirm: true } : undefined,
    );
    setMsg(r.ok ? "" : errorText(r));
    void load();
  }

  async function bulk(verb: "cancel" | "retry") {
    const chosen = rows.filter((r) => sel.selected.has(r.id) && verbFor(r, verb));
    const results = await Promise.all(
      chosen.map((r) => call(`/api/v1/scheduled-messages/${r.id}/${verb}`, "POST")),
    );
    const failed = results.filter((r) => !r.ok);
    setMsg(
      failed.length ? `${failed.length} of ${chosen.length} failed: ${errorText(failed[0]!)}` : "",
    );
    sel.clear();
    void load();
  }

  return (
    <Tabs label="Scheduled email states" tabs={TABS} value={tab} onChange={setTab}>
      <div className="flex flex-col gap-3">
        {tab === "HELD" && (
          <p className="text-sm text-muted-foreground">
            These emails may or may not have been delivered. Cancel skips this step for the lead.
            Release tries again and can send a second copy.
          </p>
        )}
        {tab === "DEAD_LETTER" && (
          <p className="text-sm text-muted-foreground">
            Failed emails were not sent: Retry sends them again. Held emails may or may not have
            been delivered: Release can send a second copy.
          </p>
        )}
        {tab === "UNCERTAIN" && (
          <p className="text-sm text-muted-foreground">
            The provider did not confirm these. The sender is checking the Sent folder and will not
            resend by itself.
          </p>
        )}
        <Input
          type="search"
          aria-label="Search scheduled emails"
          placeholder="Searches loaded rows: lead, account, subject"
          className="max-w-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {canEdit && sel.selected.size > 0 && (
          <BulkToolbar count={sel.selected.size}>
            {(tab === "SCHEDULED" || tab === "HELD" || tab === "DEAD_LETTER") && (
              <Button variant="outline" onClick={() => void bulk("cancel")}>
                Cancel selected
              </Button>
            )}
            {tab === "DEAD_LETTER" && (
              <Button variant="outline" onClick={() => void bulk("retry")}>
                Retry selected
              </Button>
            )}
          </BulkToolbar>
        )}
        {msg && (
          <p role="alert" className="text-sm text-destructive">
            {msg}
          </p>
        )}
        <Card className="overflow-x-auto p-0">
          <table
            aria-label={`${TABS.find((t) => t.id === tab)!.label} emails`}
            className="w-full text-left text-sm"
          >
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="w-10 p-3">
                  <input
                    type="checkbox"
                    aria-label={`Select all ${ids.length} loaded emails`}
                    checked={allOn}
                    disabled={!canEdit || ids.length === 0}
                    onChange={() => sel.setAll(ids, !allOn)}
                  />
                </th>
                <SortTh col="lead" sort={sort} onSort={sortBy}>
                  Lead
                </SortTh>
                <SortTh col="account" sort={sort} onSort={sortBy}>
                  Sending account
                </SortTh>
                <SortTh col="subject" sort={sort} onSort={sortBy}>
                  Subject
                </SortTh>
                <SortTh col="due" sort={sort} onSort={sortBy}>
                  Due
                </SortTh>
                <th scope="col" className="p-3 font-medium">
                  Details
                </th>
                <th scope="col" className="p-3 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-border align-top">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`Select email to ${r.leadEmail}`}
                      checked={sel.selected.has(r.id)}
                      disabled={!canEdit}
                      onChange={() => sel.toggle(r.id)}
                    />
                  </td>
                  <td className="p-3">{r.leadEmail}</td>
                  <td className="p-3">{r.accountEmail}</td>
                  <td className="p-3">{r.renderedSubject}</td>
                  <td className="p-3">{at(r.sentAt ?? r.dueAt)}</td>
                  <td className="p-3 text-xs">
                    {r.uncertainAt && (
                      <p>
                        Unconfirmed since {at(r.uncertainAt)}. Sent folder searched {r.searchCount}{" "}
                        time(s)
                        {r.lastSearchAt ? `, last ${at(r.lastSearchAt)}` : ""}.
                      </p>
                    )}
                    {r.error && <p>{r.error}</p>}
                  </td>
                  <td className="p-3">
                    {canEdit && (
                      <div className="flex gap-1">
                        {r.status === "HELD" && isAdmin && (
                          <Button
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            aria-label={`Release email to ${r.leadEmail}`}
                            onClick={() => setRelease(r)}
                          >
                            Release
                          </Button>
                        )}
                        {(r.status === "HELD" || r.status === "SCHEDULED") && (
                          <Button
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            title="Skip this step for the lead"
                            aria-label={`Cancel email to ${r.leadEmail}: skip this step for the lead`}
                            onClick={() => void act(r, "cancel")}
                          >
                            Cancel
                          </Button>
                        )}
                        {r.status === "FAILED" && (
                          <Button
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            aria-label={`Retry email to ${r.leadEmail}`}
                            onClick={() => void act(r, "retry")}
                          >
                            Retry
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {loaded && shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Nothing here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        {sort && next && (
          <p role="status" className="text-sm text-muted-foreground">
            Sorted within the {rows.length} rows loaded.
          </p>
        )}
        {next && <NextPage onClick={() => void load(next)} />}
      </div>
      {release && (
        <ReleaseDialog
          row={release}
          onClose={() => setRelease(null)}
          onConfirm={() => {
            void act(release, "release");
            setRelease(null);
          }}
        />
      )}
    </Tabs>
  );
}

/** Native modal <dialog>: the browser traps focus and Escape closes it. Focus starts on the safe choice. */
function ReleaseDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: Row;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="release-title"
      aria-describedby="release-warning"
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/40"
    >
      <h2 id="release-title" className="text-lg font-semibold">
        Release this email?
      </h2>
      <p className="mt-2 text-sm">
        To {row.leadEmail}: {row.renderedSubject}
      </p>
      <p id="release-warning" className="mt-2 text-sm font-medium">
        This email may already have been delivered. Releasing can send it a second time.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button autoFocus variant="outline" onClick={() => dialog.current?.close()}>
          Keep held
        </Button>
        <Button onClick={onConfirm}>Release anyway</Button>
      </div>
    </dialog>
  );
}
