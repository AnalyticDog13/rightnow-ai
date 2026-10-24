"use client";

import { useCallback, useEffect, useState } from "react";
import { BulkToolbar, NextPage, SortTh, useSort } from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
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
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

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

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form onSubmit={add} className="flex flex-col gap-2">
          <Label htmlFor="bl-values">
            Add emails or domains (separated by spaces, commas or new lines, up to 1000)
          </Label>
          <textarea
            id="bl-values"
            rows={3}
            className="max-w-xl rounded-md border border-border bg-card p-3 text-sm"
            placeholder="bad@example.com, spam-domain.com"
            value={values}
            onChange={(e) => setValues(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!values.trim()}>
              Add to blocklist
            </Button>
            <Label htmlFor="bl-import" className="text-sm">
              Import CSV
            </Label>
            <input
              id="bl-import"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search blocklist"
          placeholder="Search"
          className="max-w-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Filter by reason"
          className={sel}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">All reasons</option>
          {Object.entries(REASON).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button asChild variant="outline">
          <a href="/api/v1/blocklist/export" download="blocklist.csv">
            Export CSV
          </a>
        </Button>
        {isAdmin && (
          <>
            <Button variant="outline" onClick={clearAll}>
              Remove all
            </Button>
          </>
        )}
      </div>
      {isAdmin && selected.size > 0 && (
        <BulkToolbar count={selected.size}>
          <Button variant="outline" onClick={bulkRemove}>
            Remove selected
          </Button>
        </BulkToolbar>
      )}
      {msg && (
        <p role="status" className="text-sm">
          {msg}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {loading
          ? "Loading…"
          : `Showing ${rows.length}${total === null ? "" : ` of ${total}`} entries`}
      </p>
      <Card className="overflow-x-auto p-0">
        <table aria-label="Blocklist" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10 p-3">
                <input
                  type="checkbox"
                  aria-label={`Select all ${ids.length} loaded entries`}
                  checked={allOn}
                  disabled={!isAdmin || ids.length === 0}
                  onChange={() => setSelected(allOn ? new Set() : new Set(ids))}
                />
              </th>
              <SortTh col="value" sort={sort} onSort={sortBy}>
                Value
              </SortTh>
              <SortTh col="kind" sort={sort} onSort={sortBy}>
                Type
              </SortTh>
              <SortTh col="reason" sort={sort} onSort={sortBy}>
                Reason
              </SortTh>
              <SortTh col="source" sort={sort} onSort={sortBy}>
                Source
              </SortTh>
              <SortTh col="added" sort={sort} onSort={sortBy}>
                Added
              </SortTh>
              <th scope="col" className="p-3 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-border">
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.value ?? "erased address"}`}
                    checked={selected.has(r.id)}
                    disabled={!isAdmin}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td className="p-3">{r.value ?? <em>erased (hash only)</em>}</td>
                <td className="p-3">{r.kind === "EMAIL" ? "Email" : "Domain"}</td>
                <td className="p-3">{REASON[r.reason]}</td>
                <td className="p-3">{r.source}</td>
                <td className="p-3">{r.createdAt.slice(0, 10)}</td>
                <td className="p-3">
                  {isAdmin && !["GDPR_ERASURE", "COMPLAINT"].includes(r.reason) && (
                    <Button
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      aria-label={`Remove ${r.value ?? "erased address"} from the blocklist`}
                      onClick={() => remove(r)}
                    >
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  The blocklist is empty.
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
