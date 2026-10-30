"use client";

import { Archive, Megaphone, Pause, Play, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Callout } from "../../../components/callout";
import { CAMPAIGN_STATUS, pillFor } from "../../../components/status-pill";
import {
  BulkToolbar,
  Pager,
  SearchInput,
  SortTh,
  TableEmpty,
  TableFrame,
  TagSelect,
  usePage,
  useSelection,
  useSort,
} from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "../accounts/api-client";
import { ProgressRing } from "./progress-ring";
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
const NAME_INPUT = "new-campaign-name";

/** B5.5: the create form lives in the page header (inline on >= 768, stacked full width below). */
export function CreateCampaign() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  async function create() {
    const r = await call("/api/v1/campaigns", "POST", { name });
    if (!r.ok) return setMsg(errorText(r));
    router.push(`/campaigns/${(r.json as { id: string }).id}`);
  }
  return (
    <form
      className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <Input
        id={NAME_INPUT}
        aria-label="New campaign name"
        placeholder="New campaign name"
        className="md:w-60"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" disabled={!name.trim()}>
        Create campaign
      </Button>
      {msg && (
        <p role="alert" className="text-[13px]/[18px] text-danger md:max-w-60">
          {msg}
        </p>
      )}
    </form>
  );
}

const ACTION_ICON: Record<string, LucideIcon> = { Pause, Resume: Play, Archive };

export function CampaignsTable({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const router = useRouter();
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
  const btn = (r: Row, verb: "pause" | "resume" | "archive", label: string) => {
    const Icon = ACTION_ICON[label]!;
    return (
      <Button
        variant="ghost"
        size="sm"
        className="max-lg:w-8 max-lg:px-0 max-md:w-11"
        title={label}
        aria-label={`${label} ${r.name}`}
        onClick={() => void act(r, verb)}
      >
        <Icon aria-hidden />
        <span className="max-lg:sr-only">{label}</span>
      </Button>
    );
  };
  const filtered = q !== "" || tag !== "";

  return (
    <div className="flex flex-col gap-3">
      {canEdit && sel.selected.size > 0 ? (
        <BulkToolbar count={sel.selected.size} onClear={sel.clear}>
          {(["pause", "resume", "archive"] as const).map((v) => (
            <Button key={v} variant="ghost" size="sm" onClick={() => void bulk(v)}>
              {v[0]!.toUpperCase() + v.slice(1)}
            </Button>
          ))}
        </BulkToolbar>
      ) : (
        <div className="flex min-h-12 flex-wrap items-center gap-2">
          <SearchInput
            aria-label="Search campaigns"
            placeholder="Search by name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <TagSelect kind="campaign" value={tag} onChange={setTag} />
          <span className="ml-auto text-[13px]/[18px] text-fg-muted tabular-nums">
            {shown.length} campaign{shown.length === 1 ? "" : "s"}
          </span>
        </div>
      )}
      {msg && (
        <Callout tone="danger" role="alert">
          {msg}
        </Callout>
      )}
      <TableFrame footer={<Pager page={pager.page} pages={pager.pages} onPage={pager.setPage} />}>
        <table aria-label="Campaigns">
          <thead>
            <tr>
              <th scope="col" data-pin="check" className="w-11">
                <input
                  type="checkbox"
                  aria-label="Select all campaigns"
                  checked={allOn}
                  disabled={!canEdit || ids.length === 0}
                  onChange={() => sel.setAll(ids, !allOn)}
                />
              </th>
              <SortTh col="name" sort={sort} onSort={sortBy} data-pin="id">
                Campaign
              </SortTh>
              <SortTh col="status" sort={sort} onSort={sortBy}>
                Status
              </SortTh>
              <SortTh col="done" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Finished
              </SortTh>
              <SortTh
                col="sent"
                sort={sort}
                onSort={sortBy}
                className="hidden text-right md:table-cell"
              >
                Sent today
              </SortTh>
              <th scope="col" className="text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((r) => {
              const tone = pillFor(CAMPAIGN_STATUS, r.status).tone;
              return (
                <tr
                  key={r.id}
                  aria-selected={sel.selected.has(r.id)}
                  data-stripe={tone === "danger" ? "danger" : undefined}
                >
                  <td data-pin="check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={sel.selected.has(r.id)}
                      disabled={!canEdit}
                      onChange={() => sel.toggle(r.id)}
                    />
                  </td>
                  <td data-pin="id" className="max-w-40 md:max-w-80">
                    <Link
                      href={`/campaigns/${r.id}`}
                      className="block truncate font-medium hover:underline"
                      title={r.name}
                    >
                      {r.name}
                    </Link>
                    <div className="text-[13px]/[18px] text-fg-subtle tabular-nums">
                      {r.total} lead{r.total === 1 ? "" : "s"}
                    </div>
                    {r.tags.length > 0 && (
                      <div className="mt-1 hidden flex-wrap gap-1 md:flex">
                        {r.tags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex h-5 items-center rounded-xs border border-border bg-sunken px-1.5 text-xs text-fg-muted"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="hidden md:table-cell">
                    <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
                      <ProgressRing done={r.completed} total={r.total} />
                      {r.completed} / {r.total} leads
                    </span>
                  </td>
                  <td className="hidden text-right tabular-nums md:table-cell">{r.sentToday}</td>
                  <td className="text-right">
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        {r.status === "Active" && btn(r, "pause", "Pause")}
                        {RESUMABLE.includes(r.status) && btn(r, "resume", "Resume")}
                        {r.status !== "Archived" && btn(r, "archive", "Archive")}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 &&
              (rows.length === 0 ? (
                <TableEmpty
                  colSpan={6}
                  icon={Megaphone}
                  title="No campaigns yet"
                  body="A campaign sends a sequence of emails to a lead list from your connected accounts, inside your sending schedule."
                  actions={
                    canEdit && (
                      <Button
                        variant="ghost"
                        onClick={() => document.getElementById(NAME_INPUT)?.focus()}
                      >
                        Name your first campaign
                      </Button>
                    )
                  }
                />
              ) : (
                <TableEmpty
                  colSpan={6}
                  icon={Search}
                  title="No campaigns match these filters."
                  actions={
                    filtered && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setQ("");
                          setTag("");
                        }}
                      >
                        Clear filters
                      </Button>
                    )
                  }
                />
              ))}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
