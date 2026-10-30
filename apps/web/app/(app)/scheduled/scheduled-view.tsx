"use client";

import { Inbox, RotateCcw, Search, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Callout } from "../../../components/callout";
import {
  MESSAGE_STATUS,
  OUTCOME_UNKNOWN_TIP,
  pillFor,
  StatusPill,
} from "../../../components/status-pill";
import { Tabs } from "../../../components/tabs";
import {
  BulkToolbar,
  NextPage,
  SearchInput,
  SortTh,
  TableEmpty,
  TableFrame,
  useSelection,
  useSort,
} from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
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
const STATUS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  SENT: "Sent",
  HELD: "Held",
  FAILED: "Failed",
  UNCERTAIN: "Outcome unknown",
  CANCELLED: "Cancelled",
};
const EMPTY: Record<string, string> = {
  SCHEDULED: "Nothing is waiting to send.",
  HELD: "No held emails. Emails are held when the send outcome must be checked by a person.",
  DEAD_LETTER: "No failed emails.",
  UNCERTAIN: "No emails with an unknown outcome.",
  CANCELLED: "No cancelled emails.",
};
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

  const label = TABS.find((t) => t.id === tab)!.label;
  return (
    <Tabs label="Scheduled email states" tabs={TABS} value={tab} onChange={setTab}>
      <div className="flex flex-col gap-3">
        {tab === "HELD" && (
          <Callout tone="warning">
            These emails may or may not have been delivered. Cancel skips this step for the lead.
            Release tries again and can send a second copy.
          </Callout>
        )}
        {tab === "DEAD_LETTER" && (
          <Callout tone="neutral">
            Failed emails were not sent: Retry sends them again. Held emails may or may not have
            been delivered: Release can send a second copy.
          </Callout>
        )}
        {tab === "UNCERTAIN" && (
          <Callout tone="neutral">
            The provider did not confirm these. The sender is checking the Sent folder and will not
            resend by itself.
          </Callout>
        )}
        {canEdit && sel.selected.size > 0 ? (
          <BulkToolbar count={sel.selected.size} onClear={sel.clear}>
            {(tab === "SCHEDULED" || tab === "HELD") && (
              <Button variant="ghost" size="sm" onClick={() => void bulk("cancel")}>
                Cancel selected
              </Button>
            )}
            {tab === "DEAD_LETTER" && (
              <Button variant="ghost" size="sm" onClick={() => void bulk("retry")}>
                Retry selected
              </Button>
            )}
          </BulkToolbar>
        ) : (
          <div className="flex min-h-12 flex-wrap items-center gap-2">
            <SearchInput
              aria-label="Search scheduled emails"
              placeholder="Searches loaded rows: lead, account, subject"
              className="sm:w-80"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {loaded && (
              <span className="ml-auto text-[13px]/[18px] text-fg-muted tabular-nums">
                {shown.length} loaded
              </span>
            )}
          </div>
        )}
        {msg && (
          <Callout tone="danger" role="alert">
            {msg}
          </Callout>
        )}
        <TableFrame>
          <table aria-label={`${label} emails`} aria-busy={!loaded || undefined}>
            <thead>
              <tr>
                <th scope="col" data-pin="check" className="w-11">
                  <input
                    type="checkbox"
                    aria-label={`Select all ${ids.length} loaded emails`}
                    checked={allOn}
                    disabled={!canEdit || ids.length === 0}
                    onChange={() => sel.setAll(ids, !allOn)}
                  />
                </th>
                <SortTh col="lead" sort={sort} onSort={sortBy} data-pin="id">
                  Lead
                </SortTh>
                <SortTh col="account" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                  Sending account
                </SortTh>
                <SortTh col="due" sort={sort} onSort={sortBy}>
                  {tab === "SCHEDULED" ? "Due" : "Due / sent at"}
                </SortTh>
                <th scope="col" className="hidden md:table-cell">
                  Status
                </th>
                <th scope="col" className="text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const status = STATUS[r.status] ?? r.status;
                const spec = pillFor(MESSAGE_STATUS, status);
                return (
                  <tr
                    key={r.id}
                    aria-selected={sel.selected.has(r.id)}
                    data-stripe={
                      spec.tone === "danger" || spec.tone === "warning" ? spec.tone : undefined
                    }
                  >
                    <td data-pin="check">
                      <input
                        type="checkbox"
                        aria-label={`Select email to ${r.leadEmail}`}
                        checked={sel.selected.has(r.id)}
                        disabled={!canEdit}
                        onChange={() => sel.toggle(r.id)}
                      />
                    </td>
                    <td data-pin="id" className="max-w-44 md:max-w-80">
                      <div className="truncate font-medium" title={r.leadEmail}>
                        {r.leadEmail}
                      </div>
                      <div
                        className="truncate text-[13px]/[18px] text-fg-subtle"
                        title={r.renderedSubject}
                      >
                        {r.renderedSubject}
                      </div>
                    </td>
                    <td className="hidden max-w-56 truncate md:table-cell" title={r.accountEmail}>
                      {r.accountEmail}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{at(r.sentAt ?? r.dueAt)}</td>
                    <td className="hidden max-w-80 md:table-cell">
                      <StatusPill
                        {...spec}
                        title={
                          status === "Outcome unknown"
                            ? OUTCOME_UNKNOWN_TIP
                            : (r.error ?? undefined)
                        }
                      >
                        {status}
                      </StatusPill>
                      {r.uncertainAt && (
                        <p className="mt-1 text-[13px]/[18px] text-fg-muted">
                          Unconfirmed since {at(r.uncertainAt)}. Sent folder searched{" "}
                          {r.searchCount} time(s)
                          {r.lastSearchAt ? `, last ${at(r.lastSearchAt)}` : ""}.
                        </p>
                      )}
                      {r.error && (
                        <p className="mt-1 font-mono text-xs break-all text-fg-muted">{r.error}</p>
                      )}
                    </td>
                    <td className="text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          {r.status === "HELD" && isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Release email to ${r.leadEmail}`}
                              onClick={() => setRelease(r)}
                            >
                              <Send aria-hidden />
                              Release
                            </Button>
                          )}
                          {(r.status === "HELD" || r.status === "SCHEDULED") && (
                            <Button
                              variant="danger-ghost"
                              size="sm"
                              title="Skip this step for the lead"
                              aria-label={`Cancel email to ${r.leadEmail}: skip this step for the lead`}
                              onClick={() => void act(r, "cancel")}
                            >
                              <X aria-hidden />
                              Cancel
                            </Button>
                          )}
                          {r.status === "FAILED" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Retry email to ${r.leadEmail}`}
                              onClick={() => void act(r, "retry")}
                            >
                              <RotateCcw aria-hidden />
                              Retry
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {loaded &&
                shown.length === 0 &&
                (rows.length === 0 ? (
                  <TableEmpty colSpan={6} icon={Inbox} title={EMPTY[tab]} />
                ) : (
                  <TableEmpty
                    colSpan={6}
                    icon={Search}
                    title="No emails match this search."
                    actions={
                      <Button variant="ghost" size="sm" onClick={() => setQ("")}>
                        Clear search
                      </Button>
                    }
                  />
                ))}
            </tbody>
          </table>
        </TableFrame>
        {sort && next && (
          <p role="status" className="text-[13px]/[18px] text-fg-muted">
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
      className="m-auto w-[min(480px,calc(100vw-32px))] max-w-none rounded-xl bg-surface p-6 text-fg shadow-e3 open:animate-pop max-md:mb-0 max-md:w-screen max-md:rounded-b-none"
    >
      <h2 id="release-title" className="text-lg/[26px] font-semibold">
        Release this email?
      </h2>
      <p className="mt-2 text-[13px]/[18px] text-fg-muted">
        To {row.leadEmail}: {row.renderedSubject}
      </p>
      {row.error && (
        <p className="mt-1 text-[13px]/[18px] text-fg-muted">
          Held because: <span className="font-mono">{row.error}</span>
        </p>
      )}
      <Callout tone="warning" className="mt-4">
        <span id="release-warning">
          This email may already have been delivered. Releasing can send it a second time.
        </span>
      </Callout>
      <div className="mt-6 flex justify-end gap-2 max-md:[&>*]:flex-1">
        <Button autoFocus variant="outline" onClick={() => dialog.current?.close()}>
          Keep held
        </Button>
        <Button onClick={onConfirm}>Release anyway</Button>
      </div>
    </dialog>
  );
}
