"use client";

import { Ban, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { pillFor, StatusPill, SUPPRESSION } from "../../../components/status-pill";
import {
  BulkToolbar,
  NextPage,
  SearchInput,
  SortTh,
  TableEmpty,
  TableFrame,
  useSort,
} from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Textarea } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { call, errorText } from "../accounts/api-client";
import { REASON } from "../leads/labels";

type Row = {
  id: string;
  kind: string;
  value: string | null;
  reason: string;
  source: string | null;
  createdAt: string;
};

export function BlocklistManager({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("");
  const [values, setValues] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);

  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams(
        Object.entries({ q, reason, ...(cursor && { cursor }) }).filter(([, v]) => v),
      );
      return `/api/v1/blocklist?${p}`;
    },
    [q, reason],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await call(url(), "GET");
      if (!live) return;
      setLoading(false);
      if (!r.ok) return setMsg(errorText(r));
      setRows((r.json.rows ?? []) as Row[]);
      setTotal(typeof r.json.total === "number" ? r.json.total : null);
      setNext((r.json.nextCursor as string | null) ?? null);
      setSelected(new Set());
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [url, tick]);

  const refresh = (m: string) => {
    setMsg(m);
    setTick((n) => n + 1);
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const list = values.split(/[\s,;]+/).filter(Boolean);
    const r = await call("/api/v1/blocklist", "POST", { values: list });
    if (!r.ok) return setMsg(errorText(r));
    const j = r.json as { added: number; duplicates: number; invalid: number };
    setValues("");
    refresh(`Added ${j.added}. Already listed ${j.duplicates}. Invalid ${j.invalid}.`);
  }

  async function importFile(f: File | undefined) {
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    const res = await fetch("/api/v1/blocklist/import", { method: "POST", body: fd }).catch(
      () => null,
    );
    const j = (await res?.json().catch(() => ({}))) as Record<string, number | string>;
    if (!res?.ok) return setMsg(typeof j.error === "string" ? j.error : "Import failed");
    refresh(`Imported: added ${j.added}, already listed ${j.duplicates}, invalid ${j.invalid}.`);
  }

  async function remove(r: Row) {
    const what = r.value ?? "this entry";
    let body: Record<string, unknown> = {};
    if (r.reason === "UNSUBSCRIBE") {
      const reason = prompt(
        `${what} unsubscribed. Remove it only if the recipient asked to be emailed again. Why is it safe to email them?`,
      );
      if (!reason?.trim()) return;
      if (!confirm("Has the recipient clearly consented to be emailed again?")) return;
      body = { resubscribeAttestation: { reason: reason.trim(), recipientConsent: true } };
    } else if (r.reason === "HARD_BOUNCE") {
      if (!confirm(`${what} bounced. Removing it risks more bounces. Remove anyway?`)) return;
      body = { confirm: true };
    } else if (!confirm(`Remove ${what}?`)) return;
    const res = await call(`/api/v1/blocklist/${r.id}`, "DELETE", body);
    refresh(res.ok ? "Removed." : errorText(res));
  }

  async function bulkRemove() {
    if (
      !confirm(
        `Remove the manual entries among the ${selected.size} selected? Every other reason is kept.`,
      )
    )
      return;
    const r = await call("/api/v1/blocklist/bulk-delete", "POST", { ids: [...selected] });
    refresh(r.ok ? `Removed ${r.json.deleted}. Kept ${r.json.kept} (not manual).` : errorText(r));
  }

  async function clearAll() {
    const typed = prompt(
      "Type DELETE ALL to remove every manual entry. Bounces, unsubscribes, complaints, not-interested and erasure records are kept.",
    );
    if (typed === null) return;
    const r = await call("/api/v1/blocklist/clear", "POST", { confirm: typed });
    refresh(r.ok ? `Removed ${r.json.deleted}. Kept ${r.json.kept} (not manual).` : errorText(r));
  }

  const {
    sorted,
    sort,
    toggle: sortBy,
  } = useSort(rows, {
    value: (r) => r.value?.toLowerCase() ?? null,
    kind: (r) => r.kind,
    reason: (r) => r.reason,
    source: (r) => r.source,
    added: (r) => r.createdAt,
  });
  const ids = rows.map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const filtered = q !== "" || reason !== "";
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <Card className="max-w-3xl">
          <form onSubmit={add} className="flex flex-col gap-3">
            <Label htmlFor="bl-values">
              Add emails or domains (separated by spaces, commas or new lines, up to 1000)
            </Label>
            <Textarea
              id="bl-values"
              rows={3}
              className="font-mono text-[13px]/5"
              placeholder="bad@example.com, spam-domain.com"
              value={values}
              onChange={(e) => setValues(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button type="submit" disabled={!values.trim()} className="max-md:w-full">
                Add to blocklist
              </Button>
              <Button asChild variant="link">
                <a href="/api/v1/blocklist/export" download="blocklist.csv">
                  Export CSV
                </a>
              </Button>
              <span className="flex items-center gap-2">
                <Label htmlFor="bl-import" className="cursor-pointer text-signal hover:underline">
                  Import CSV
                </Label>
                <input
                  id="bl-import"
                  type="file"
                  accept=".csv,text/csv"
                  className="max-w-56 text-[13px]/[18px] text-fg-muted file:mr-2 file:rounded-sm file:border file:border-border-strong file:bg-surface file:px-2 file:py-1 file:text-fg"
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
              </span>
            </div>
          </form>
        </Card>
      )}
      {!canEdit && (
        <Button asChild variant="link" className="self-start">
          <a href="/api/v1/blocklist/export" download="blocklist.csv">
            Export CSV
          </a>
        </Button>
      )}
      {isAdmin && selected.size > 0 ? (
        <BulkToolbar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button variant="ghost" size="sm" onClick={bulkRemove}>
            Remove selected
          </Button>
        </BulkToolbar>
      ) : (
        <div className="flex min-h-12 flex-wrap items-center gap-2">
          <SearchInput
            aria-label="Search blocklist"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            size="sm"
            aria-label="Filter by reason"
            className="w-auto"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">All reasons</option>
            {Object.entries(REASON).map(([k, v]) => (
              <option key={k} value={k}>
                Reason: {v}
              </option>
            ))}
          </Select>
          <span className="text-[13px]/[18px] text-fg-muted tabular-nums md:ml-auto">
            {loading
              ? "Loading…"
              : `Showing ${rows.length}${total === null ? "" : ` of ${total}`} entries`}
          </span>
          {isAdmin && (
            <Button variant="danger-ghost" size="sm" onClick={clearAll}>
              <Trash2 aria-hidden />
              Remove all
            </Button>
          )}
        </div>
      )}
      {msg && (
        <p role="status" className="text-sm">
          {msg}
        </p>
      )}
      <TableFrame>
        <table aria-label="Blocklist" aria-busy={loading || undefined}>
          <thead>
            <tr>
              <th scope="col" data-pin="check" className="w-11">
                <input
                  type="checkbox"
                  aria-label={`Select all ${ids.length} loaded entries`}
                  checked={allOn}
                  disabled={!isAdmin || ids.length === 0}
                  onChange={() => setSelected(allOn ? new Set() : new Set(ids))}
                />
              </th>
              <SortTh col="value" sort={sort} onSort={sortBy} data-pin="id">
                Value
              </SortTh>
              <SortTh col="kind" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Type
              </SortTh>
              <SortTh col="reason" sort={sort} onSort={sortBy}>
                Reason
              </SortTh>
              <SortTh col="source" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Source
              </SortTh>
              <SortTh col="added" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Added
              </SortTh>
              <th scope="col" className="text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const label = REASON[r.reason] ?? r.reason;
              return (
                <tr key={r.id} aria-selected={selected.has(r.id)}>
                  <td data-pin="check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.value ?? "erased address"}`}
                      checked={selected.has(r.id)}
                      disabled={!isAdmin}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td data-pin="id" className="max-w-44 truncate font-mono text-[13px] md:max-w-80">
                    {r.value ?? <em className="font-sans text-fg-subtle">erased (hash only)</em>}
                  </td>
                  <td className="hidden md:table-cell">
                    {r.kind === "EMAIL" ? "Email" : "Domain"}
                  </td>
                  <td>
                    <StatusPill {...pillFor(SUPPRESSION, label)}>{label}</StatusPill>
                  </td>
                  <td className="hidden text-fg-muted md:table-cell">
                    {r.source ?? <span className="text-fg-subtle">-</span>}
                  </td>
                  <td className="hidden whitespace-nowrap tabular-nums md:table-cell">
                    {r.createdAt.slice(0, 10)}
                  </td>
                  <td className="text-right">
                    {isAdmin && !["GDPR_ERASURE", "COMPLAINT"].includes(r.reason) && (
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        aria-label={`Remove ${r.value ?? "erased address"} from the blocklist`}
                        onClick={() => remove(r)}
                      >
                        <Trash2 aria-hidden />
                        <span className="max-lg:sr-only">Remove</span>
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading &&
              rows.length === 0 &&
              (filtered ? (
                <TableEmpty
                  colSpan={7}
                  icon={Search}
                  title="No entries match these filters."
                  actions={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQ("");
                        setReason("");
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <TableEmpty
                  colSpan={7}
                  icon={Ban}
                  title="Nothing is blocked yet."
                  body="Unsubscribes, hard bounces and complaints will appear here automatically."
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
      {next && (
        <NextPage
          onClick={async () => {
            const r = await call(url(next), "GET");
            if (!r.ok) return setMsg(errorText(r));
            setRows((o) => [...o, ...((r.json.rows ?? []) as Row[])]);
            setNext((r.json.nextCursor as string | null) ?? null);
          }}
        />
      )}
    </div>
  );
}
