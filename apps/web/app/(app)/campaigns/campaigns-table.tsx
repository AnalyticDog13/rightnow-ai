"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import {
  BulkToolbar,
  Pager,
  SortTh,
  TagSelect,
  usePage,
  useSelection,
  useSort,
} from "../../../components/table-kit";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "../accounts/api-client";
import { StatusBadge } from "./status-badge";

type Row = {
  id: string;
  name: string;
  tags: string[];
  status: string;
  total: number;
  completed: number;
  sentToday: number;
};
const RESUMABLE = ["Paused", "Bounce Protect", "Accounts Unhealthy", "Completed"];

export function CampaignsTable({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const sel = useSelection();
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!tag || r.tags.includes(tag)) && r.name.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [rows, q, tag],
  );
  const {
    sorted,
    sort,
    toggle: sortBy,
  } = useSort(shown, {
    name: (r) => r.name.toLowerCase(),
    status: (r) => r.status,
    done: (r) => (r.total ? r.completed / r.total : 0),
    sent: (r) => r.sentToday,
  });
  const pager = usePage(sorted);
  const ids = pager.rows.map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((id) => sel.selected.has(id));

  async function create() {
    const r = await call("/api/v1/campaigns", "POST", { name });
    if (!r.ok) return setMsg(errorText(r));
    router.push(`/campaigns/${(r.json as { id: string }).id}`);
  }
  async function act(r: Row, verb: "pause" | "resume" | "archive") {
    const res = await call(
      `/api/v1/campaigns/${r.id}/${verb}`,
      "POST",
      verb === "resume" ? {} : undefined,
    );
    setMsg(res.ok ? "" : `${r.name}: ${errorText(res)}`);
    router.refresh();
  }
  async function bulk(verb: "pause" | "resume" | "archive") {
    const chosen = rows.filter((r) => sel.selected.has(r.id));
    const fails: string[] = [];
    for (const r of chosen) {
      const res = await call(
        `/api/v1/campaigns/${r.id}/${verb}`,
        "POST",
        verb === "resume" ? {} : undefined,
      );
      if (!res.ok) fails.push(`${r.name}: ${errorText(res)}`);
    }
    setMsg(fails.join("; "));
    sel.clear();
    router.refresh();
  }
  const btn = (r: Row, verb: "pause" | "resume" | "archive", label: string) => (
    <Button
      variant="outline"
      className="h-8 px-2 text-xs"
      aria-label={`${label} ${r.name}`}
      onClick={() => void act(r, verb)}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input
            aria-label="New campaign name"
            placeholder="New campaign name"
            className="max-w-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim()}>
            Create campaign
          </Button>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search campaigns"
          placeholder="Search by name"
          className="max-w-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <TagSelect kind="campaign" value={tag} onChange={setTag} />
      </div>
      {canEdit && sel.selected.size > 0 && (
        <BulkToolbar count={sel.selected.size}>
          {(["pause", "resume", "archive"] as const).map((v) => (
            <Button key={v} variant="outline" onClick={() => void bulk(v)}>
              {v[0]!.toUpperCase() + v.slice(1)}
            </Button>
          ))}
        </BulkToolbar>
      )}
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}
      <Card className="overflow-x-auto p-0">
        <table aria-label="Campaigns" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="w-10 p-3">
                <input
                  type="checkbox"
                  aria-label="Select all campaigns"
                  checked={allOn}
                  disabled={!canEdit || ids.length === 0}
                  onChange={() => sel.setAll(ids, !allOn)}
                />
              </th>
              <SortTh col="name" sort={sort} onSort={sortBy}>
                Campaign
              </SortTh>
              <SortTh col="status" sort={sort} onSort={sortBy}>
                Status
              </SortTh>
              <SortTh col="done" sort={sort} onSort={sortBy}>
                Finished
              </SortTh>
              <SortTh col="sent" sort={sort} onSort={sortBy}>
                Sent today
              </SortTh>
              <th scope="col" className="p-3 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border"
                aria-selected={sel.selected.has(r.id)}
              >
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.name}`}
                    checked={sel.selected.has(r.id)}
                    disabled={!canEdit}
                    onChange={() => sel.toggle(r.id)}
                  />
                </td>
                <td className="p-3">
                  <Link href={`/campaigns/${r.id}`} className="underline">
                    {r.name}
                  </Link>
                </td>
                <td className="p-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="p-3 tabular-nums">
                  {r.completed} / {r.total} leads
                </td>
                <td className="p-3 tabular-nums">{r.sentToday}</td>
                <td className="p-3">
                  {canEdit && (
                    <div className="flex gap-1">
                      {r.status === "Active" && btn(r, "pause", "Pause")}
                      {RESUMABLE.includes(r.status) && btn(r, "resume", "Resume")}
                      {r.status !== "Archived" && btn(r, "archive", "Archive")}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  {rows.length === 0 ? "No campaigns yet." : "No campaigns match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <Pager page={pager.page} pages={pager.pages} onPage={pager.setPage} />
    </div>
  );
}
