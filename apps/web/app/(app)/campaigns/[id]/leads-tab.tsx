"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { call, errorText } from "../../accounts/api-client";
import type { Named } from "./campaign-builder";

type Row = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  campaignStatus?: string;
};
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";
const SKIP: Record<string, string> = {
  in_other_active_campaign: "in another live campaign",
  already_in_campaign: "already in this campaign",
  suppressed: "suppressed",
  deleted: "deleted",
};

export function LeadsTab({
  campaignId,
  lists,
  statuses,
  canEdit,
  version,
  onChange,
}: {
  campaignId: string;
  lists: Named[];
  statuses: string[];
  canEdit: boolean;
  version: number;
  onChange: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState("");
  const [dupes, setDupes] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const base = `/api/v1/campaigns/${campaignId}/leads`;

  const load = useCallback(
    async (cursor?: string) => {
      const q = new URLSearchParams({ take: "50" });
      if (filter) q.set("status", filter);
      if (cursor) q.set("cursor", cursor);
      const r = await call(`${base}?${q}`, "GET");
      if (!r.ok) return setMsg(errorText(r));
      const got = (r.json.leads ?? []) as Row[];
      setRows((o) => (cursor ? [...o, ...got] : got));
      setNext((r.json.nextCursor as string | null) ?? null);
    },
    [base, filter],
  );
  useEffect(() => {
    void load();
  }, [load, tick, version]);
  useEffect(() => {
    // exact per-status totals: one count query each (take=1 keeps it light)
    void Promise.all(
      statuses.map((s) =>
        call(`${base}?status=${s}&take=1`, "GET").then(
          (r) => [s, Number(r.json.total ?? 0)] as const,
        ),
      ),
    ).then((e) => setCounts(Object.fromEntries(e)));
  }, [base, statuses, tick, version]);

  async function enroll() {
    const r = await call(base, "POST", {
      ...(source ? { listId: source } : { filter: {} }),
      allowDuplicates: dupes,
    });
    if (!r.ok) return setMsg(errorText(r));
    const j = r.json as { enrolled: number; skipped: Record<string, number> };
    const skipped = Object.entries(j.skipped)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${SKIP[k] ?? k}`);
    setMsg(
      `Enrolled ${j.enrolled} lead(s)${skipped.length ? `; skipped ${skipped.join(", ")}` : ""}.`,
    );
    setTick((n) => n + 1);
    onChange();
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void enroll();
          }}
        >
          <select
            aria-label="Lead source"
            className={sel}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All leads</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                List: {l.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={dupes} onChange={(e) => setDupes(e.target.checked)} />
            Allow leads that are in another live campaign
          </label>
          <Button type="submit">Enroll leads</Button>
        </form>
      )}
      {msg && (
        <p role="status" className="text-sm">
          {msg}
        </p>
      )}
      <ul aria-label="Lead status totals" className="flex flex-wrap gap-3 text-sm">
        {statuses.map((s) => (
          <li key={s}>
            {s} <span className="tabular-nums font-medium">{counts[s] ?? 0}</span>
          </li>
        ))}
      </ul>
      <select
        aria-label="Filter by status"
        className={`${sel} max-w-48`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <Card className="overflow-x-auto p-0">
        <table aria-label="Campaign leads" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Email", "Name", "Company", "Status"].map((h) => (
                <th key={h} className="p-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="p-3">{l.email}</td>
                <td className="p-3">{[l.firstName, l.lastName].filter(Boolean).join(" ")}</td>
                <td className="p-3">{l.companyName}</td>
                <td className="p-3">{l.campaignStatus}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  No leads in this campaign yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {next && (
        <Button variant="outline" className="self-start" onClick={() => void load(next)}>
          Load more
        </Button>
      )}
    </div>
  );
}
