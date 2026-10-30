"use client";

import type { ApiLead } from "@rightnow/core";
import { ListPlus, RotateCcw, Search, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AiReview } from "../../../components/ai-review";
import { Callout } from "../../../components/callout";
import { ActionCard, EmptyState } from "../../../components/empty-state";
import { chipClass } from "../../../components/overlay";
import { PageHeader } from "../../../components/page-header";
import { SectionTabs } from "../../../components/section-tabs";
import {
  INTEREST as INTEREST_PILL,
  pillFor,
  StatusPill,
  SUPPRESSION,
  VERIFICATION as VERIFICATION_PILL,
} from "../../../components/status-pill";
import {
  NextPage,
  nextSort,
  SearchInput,
  SortTh,
  TableEmpty,
  TableFrame,
  TagSelect,
  type Sort,
} from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { call, errorText } from "../accounts/api-client";
import { BulkBar, type Member, type Named } from "./bulk-bar";
import { ImportWizard } from "./import-wizard";
import { ESP, INTEREST, LEAD_TABS, REASON, VERIFICATION } from "./labels";
import { LeadDrawer } from "./lead-drawer";
import { SavedFilters } from "./saved-filters";

type Filters = Record<string, string>;
type Bounced = {
  id: string;
  value: string | null;
  reason: string;
  source: string | null;
  createdAt: string;
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  } | null;
};
const fullName = (l: { firstName: string | null; lastName: string | null }) =>
  [l.firstName, l.lastName].filter(Boolean).join(" ");
const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
const day = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
const dash = <span className="text-fg-subtle">-</span>;

export function LeadsTable({
  lists,
  labels,
  members,
  canEdit,
  isAdmin,
  initialListId,
}: {
  lists: Named[];
  labels: string[];
  members: Member[];
  canEdit: boolean;
  isAdmin: boolean;
  initialListId: string;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initialListId ? { listId: initialListId } : {});
  const [bounced, setBounced] = useState(false);
  const [sort, setSort] = useState<Sort>(null); // server-side: the API orders the whole result
  const [leads, setLeads] = useState<ApiLead[]>([]);
  const [rows, setRows] = useState<Bounced[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [aiJob, setAiJob] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  // result of the last action; a refetch must not wipe it
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  const url = useCallback(
    (cursor?: string) => {
      // the blocklist query is strict: send it only what it accepts
      const keep = bounced ? ["q"] : Object.keys(f);
      const p = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && keep.includes(k)));
      if (bounced) {
        p.set("reason", "HARD_BOUNCE");
        p.set("kind", "EMAIL");
      }
      if (cursor) p.set("cursor", cursor);
      if (sort && !bounced) {
        p.set("sort", sort.col);
        p.set("dir", sort.dir === "ascending" ? "asc" : "desc");
      }
      return `${bounced ? "/api/v1/blocklist" : "/api/v1/leads"}?${p}`;
    },
    [f, bounced, sort],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await call(url(), "GET");
      if (!live) return;
      setLoading(false);
      if (!r.ok) return setMsg(errorText(r));
      setMsg("");
      if (bounced) setRows((r.json.rows ?? []) as Bounced[]);
      else setLeads((r.json.leads ?? []) as ApiLead[]);
      setTotal(typeof r.json.total === "number" ? r.json.total : null);
      setNext((r.json.nextCursor as string | null) ?? null);
      setSelected(new Set());
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [url, bounced, tick]);

  async function more() {
    const r = await call(url(next!), "GET");
    if (!r.ok) return setMsg(errorText(r));
    if (bounced) setRows((o) => [...o, ...((r.json.rows ?? []) as Bounced[])]);
    else setLeads((o) => [...o, ...((r.json.leads ?? []) as ApiLead[])]);
    setNext((r.json.nextCursor as string | null) ?? null);
  }

  async function removeSuppression(b: Bounced) {
    if (!confirm(`Remove ${b.value} from the blocklist? It can be emailed again.`)) return;
    const r = await call(`/api/v1/blocklist/${b.id}`, "DELETE", { confirm: true });
    setNotice({ text: r.ok ? `Removed ${b.value} from the blocklist.` : errorText(r), ok: r.ok });
    setTick((n) => n + 1);
  }

  async function reverify(b: Bounced) {
    const r = await call("/api/v1/leads/verify", "POST", { ids: [b.lead!.id] });
    setNotice({ text: r.ok ? `Queued ${b.value} for checking.` : errorText(r), ok: r.ok });
  }

  const ids = leads.map((l) => l.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const open = leads.find((l) => l.id === openId);
  const shown = bounced ? rows.length : leads.length;
  const filtered = Object.values(f).some(Boolean);
  const memberName = Object.fromEntries(members.map((m) => [m.userId, m.name]));
  // a fresh workspace: nothing to filter or sort yet, so the page explains how to start
  const fresh = !bounced && !loading && !msg && !filtered && total === 0 && leads.length === 0;
  const refetch = () => setTick((n) => n + 1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leads"
        description="Everyone you can contact. Unsubscribed, bounced and blocklisted addresses are never emailed."
        tabs={<SectionTabs tabs={LEAD_TABS} />}
        actions={
          <>
            <Button asChild variant="outline">
              <a
                href={`/api/v1/leads/export?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`}
                download="leads.csv"
              >
                Export filtered
              </a>
            </Button>
            {canEdit && <ImportWizard lists={lists} onDone={refetch} />}
          </>
        }
      />
      <div className="flex flex-col gap-3">
        {!bounced && <SavedFilters filters={f} onApply={setF} />}
        {canEdit && !bounced && selected.size > 0 ? (
          <BulkBar
            ids={[...selected]}
            emails={leads.filter((l) => selected.has(l.id)).map((l) => l.email)}
            lists={lists}
            members={members}
            fromListId={f.listId ?? ""}
            filterQuery={new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()}
            isAdmin={isAdmin}
            onClear={() => setSelected(new Set())}
            onDone={(text, ok) => {
              setNotice({ text, ok });
              refetch();
            }}
            onPersonalize={setAiJob}
          />
        ) : (
          <div className="flex min-h-12 flex-wrap items-center gap-2">
            <SearchInput
              aria-label="Search leads"
              placeholder="Search email, name or company"
              value={f.q ?? ""}
              onChange={(e) => set("q", e.target.value)}
            />
            {/* below 768 the filters are one sideways-scrolling row instead of five stacked selects */}
            <div className="flex gap-2 max-md:-mx-4 max-md:w-[calc(100%+2rem)] max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none] md:contents [&>*]:shrink-0">
              {!bounced && (
                <>
                  <Select
                    size="sm"
                    aria-label="Filter by list"
                    value={f.listId ?? ""}
                    onChange={(e) => set("listId", e.target.value)}
                  >
                    <option value="">All lists</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        List: {l.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    size="sm"
                    aria-label="Filter by interest"
                    value={f.interestStatus ?? ""}
                    onChange={(e) => set("interestStatus", e.target.value)}
                  >
                    <option value="">All interest</option>
                    {Object.entries(INTEREST).map(([k, v]) => (
                      <option key={k} value={k}>
                        Interest: {v}
                      </option>
                    ))}
                  </Select>
                  <Select
                    size="sm"
                    aria-label="Filter by verification"
                    value={f.verificationStatus ?? ""}
                    onChange={(e) => set("verificationStatus", e.target.value)}
                  >
                    <option value="">All verification</option>
                    {Object.entries(VERIFICATION)
                      .filter(([k]) => k !== "PENDING_JOB")
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          Verification: {v}
                        </option>
                      ))}
                  </Select>
                  <Select
                    size="sm"
                    aria-label="Filter by label"
                    value={f.label ?? ""}
                    onChange={(e) => set("label", e.target.value)}
                  >
                    <option value="">All labels</option>
                    {labels.map((l) => (
                      <option key={l} value={l}>
                        Label: {l}
                      </option>
                    ))}
                  </Select>
                  <Select
                    size="sm"
                    aria-label="Filter by owner"
                    value={f.ownerId ?? ""}
                    onChange={(e) => set("ownerId", e.target.value)}
                  >
                    <option value="">Any owner</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        Owner: {m.name}
                      </option>
                    ))}
                  </Select>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                aria-pressed={bounced}
                className="aria-pressed:border-signal aria-pressed:bg-signal-tint aria-pressed:text-signal"
                onClick={() => setBounced((b) => !b)}
              >
                Bounced
              </Button>
            </div>
            <p role="status" className="ml-auto text-[13px]/[18px] text-fg-muted tabular-nums">
              {loading
                ? "Loading…"
                : `Showing ${shown}${total === null ? "" : ` of ${total}`} ${bounced ? "bounced addresses" : "leads"}`}
            </p>
          </div>
        )}
        {!bounced && (
          <details className="group text-[13px]/[18px]">
            <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-sm px-2.5 font-medium text-fg-muted hover:bg-hover hover:text-fg max-md:min-h-11 [&::-webkit-details-marker]:hidden">
              More filters
              <span aria-hidden className="text-fg-subtle group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-3">
              <TagSelect kind="lead" value={f.tag ?? ""} onChange={(t) => set("tag", t)} />
              <label className="flex min-h-11 items-center gap-2 md:min-h-8">
                <input
                  type="checkbox"
                  checked={f.openedNoReply === "true"}
                  onChange={(e) => set("openedNoReply", e.target.checked ? "true" : "")}
                />
                Opened, no reply
              </label>
              <label className="flex items-center gap-2">
                Last contacted from
                <Input
                  type="date"
                  className="w-40 md:h-8"
                  value={f.lastContactedFrom ?? ""}
                  onChange={(e) => set("lastContactedFrom", e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2">
                to
                <Input
                  type="date"
                  className="w-40 md:h-8"
                  value={f.lastContactedTo ?? ""}
                  onChange={(e) => set("lastContactedTo", e.target.value)}
                />
              </label>
              <Input
                aria-label="Custom field name"
                placeholder="Custom field"
                className="max-w-36 md:h-8"
                value={f.customKey ?? ""}
                onChange={(e) => set("customKey", e.target.value)}
              />
              <Input
                aria-label="Custom field contains"
                placeholder="contains"
                className="max-w-36 md:h-8"
                value={f.customContains ?? ""}
                onChange={(e) => set("customContains", e.target.value)}
              />
            </div>
          </details>
        )}
        {aiJob && (
          <Card className="flex flex-col gap-3">
            <section aria-label="AI personalization review" className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="size-4 text-ai" aria-hidden />
                Personalization to review
                <StatusPill tone="ai" size="sm">
                  AI draft
                </StatusPill>
              </h2>
              <div className="text-ai">
                <AiReview filter={`jobId=${aiJob}`} onApproved={refetch} />
              </div>
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setAiJob("")}>
                Close review
              </Button>
            </section>
          </Card>
        )}
        {msg && (
          <Callout tone="danger" role="alert">
            {msg}
          </Callout>
        )}
        {notice && (
          <Callout
            tone={notice.ok ? "success" : "danger"}
            role={notice.ok ? "status" : "alert"}
            action={
              <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
                Dismiss message
              </Button>
            }
          >
            {notice.text}
          </Callout>
        )}
        {fresh ? (
          <EmptyState
            variant="page"
            title="No leads yet"
            body="Import a CSV with at least an email column. Duplicates and blocklisted addresses are skipped."
            actions={
              <>
                {canEdit && <ImportWizard lists={lists} onDone={refetch} card />}
                <ActionCard
                  icon={ListPlus}
                  title="Create a lead list"
                  description="Group leads for enrollment in a campaign."
                  onClick={() => router.push("/leads/lists")}
                />
              </>
            }
          />
        ) : bounced ? (
          <TableFrame className="border-danger-solid/30">
            <table aria-label="Bounced leads" aria-busy={loading}>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col" className="hidden md:table-cell">
                    Name
                  </th>
                  <th scope="col" className="hidden md:table-cell">
                    Company
                  </th>
                  <th scope="col">Reason</th>
                  <th scope="col" className="hidden md:table-cell">
                    Added
                  </th>
                  <th scope="col" className="text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const label = REASON[b.reason] ?? b.reason;
                  return (
                    <tr key={b.id} data-stripe="danger">
                      <td className="max-w-64 truncate font-mono text-[13px]" title={b.value ?? ""}>
                        {b.value}
                      </td>
                      <td className="hidden md:table-cell">{b.lead ? fullName(b.lead) : dash}</td>
                      <td className="hidden md:table-cell">{b.lead?.companyName ?? dash}</td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusPill {...pillFor(SUPPRESSION, label)}>{label}</StatusPill>
                          {b.source && (
                            <span className="text-[13px]/[18px] text-fg-subtle">({b.source})</span>
                          )}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap text-fg-muted md:table-cell">
                        {b.createdAt.slice(0, 10)}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {canEdit && b.lead && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Re-verify ${b.value}`}
                              onClick={() => reverify(b)}
                            >
                              <RotateCcw aria-hidden />
                              Re-verify
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="danger-ghost"
                              size="sm"
                              aria-label={`Remove ${b.value} from the blocklist`}
                              onClick={() => removeSuppression(b)}
                            >
                              <Trash2 aria-hidden />
                              Remove
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && rows.length === 0 && (
                  <TableEmpty
                    colSpan={6}
                    icon={Search}
                    title="No bounced addresses."
                    body="Hard bounces are added to the blocklist automatically."
                  />
                )}
              </tbody>
            </table>
          </TableFrame>
        ) : (
          <TableFrame>
            <table aria-label="Leads" aria-busy={loading}>
              <thead>
                <tr>
                  <th data-pin="check" className="w-11">
                    <input
                      type="checkbox"
                      aria-label={`Select all ${ids.length} loaded leads`}
                      checked={allOn}
                      disabled={!canEdit || ids.length === 0}
                      onChange={() => setSelected(allOn ? new Set() : new Set(ids))}
                    />
                  </th>
                  {/* sortable = columns whose database order is the order shown */}
                  <SortTh
                    col="email"
                    sort={sort}
                    onSort={(c) => setSort((s) => nextSort(s, c))}
                    data-pin="id"
                  >
                    Email
                  </SortTh>
                  <SortTh
                    col="companyName"
                    sort={sort}
                    onSort={(c) => setSort((s) => nextSort(s, c))}
                    className="hidden md:table-cell"
                  >
                    Company
                  </SortTh>
                  <SortTh
                    col="interestStatus"
                    sort={sort}
                    onSort={(c) => setSort((s) => nextSort(s, c))}
                  >
                    Interest
                  </SortTh>
                  <th scope="col" className="hidden md:table-cell">
                    Verification
                  </th>
                  <th scope="col" className="hidden lg:table-cell">
                    Labels
                  </th>
                  <th scope="col" className="hidden lg:table-cell">
                    Owner
                  </th>
                  <th scope="col" className="hidden md:table-cell">
                    Last activity
                  </th>
                  <th scope="col" className="hidden xl:table-cell">
                    ESP
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading &&
                  leads.length === 0 &&
                  Array.from({ length: 5 }, (_, i) => (
                    <tr key={`sk${i}`} aria-hidden>
                      <td colSpan={9}>
                        <span className="block h-3 w-2/3 animate-shimmer rounded-xs bg-sunken" />
                      </td>
                    </tr>
                  ))}
                {leads.map((l) => {
                  const name = fullName(l);
                  const interest =
                    l.interestStatus === null ? null : INTEREST[String(l.interestStatus)];
                  const verification = VERIFICATION[l.verificationStatus] ?? "";
                  const owner = l.ownerId ? memberName[l.ownerId] : undefined;
                  return (
                    <tr
                      key={l.id}
                      tabIndex={0}
                      aria-selected={selected.has(l.id)}
                      className="cursor-pointer focus-visible:-outline-offset-2"
                      onClick={() => setOpenId(l.id)}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          setOpenId(l.id);
                        }
                      }}
                    >
                      <td data-pin="check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.email}`}
                          checked={selected.has(l.id)}
                          disabled={!canEdit}
                          onChange={() => toggle(l.id)}
                        />
                      </td>
                      <td data-pin="id" className="max-w-64">
                        <div className="truncate font-medium" title={l.email}>
                          {l.email}
                        </div>
                        {(name || l.jobTitle) && (
                          <div className="truncate text-[13px]/[18px] text-fg-subtle">
                            {[name, l.jobTitle].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="hidden max-w-48 truncate md:table-cell">
                        {l.companyName ?? dash}
                      </td>
                      <td>
                        {interest && (
                          <StatusPill {...pillFor(INTEREST_PILL, interest)}>{interest}</StatusPill>
                        )}
                      </td>
                      <td className="hidden md:table-cell">
                        <StatusPill {...pillFor(VERIFICATION_PILL, verification)}>
                          {verification}
                        </StatusPill>
                      </td>
                      <td className="hidden lg:table-cell">
                        {l.labels.length ? (
                          <span className="flex flex-wrap gap-1">
                            {l.labels.slice(0, 2).map((t) => (
                              <span key={t} className={chipClass}>
                                {t}
                              </span>
                            ))}
                            {l.labels.length > 2 && (
                              <span className={chipClass} title={l.labels.slice(2).join(", ")}>
                                +{l.labels.length - 2}
                              </span>
                            )}
                          </span>
                        ) : (
                          dash
                        )}
                      </td>
                      <td className="hidden lg:table-cell">
                        {owner ? (
                          <span
                            title={owner}
                            className="grid size-6 place-items-center rounded-full bg-sunken font-mono text-[11px] font-medium text-fg-muted"
                          >
                            {initials(owner)}
                            <span className="sr-only">{owner}</span>
                          </span>
                        ) : (
                          dash
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap text-fg-muted md:table-cell">
                        {day(l.lastTouchAt ?? l.lastContactedAt) ?? dash}
                      </td>
                      <td className="hidden text-fg-muted xl:table-cell">{ESP[l.espType]}</td>
                    </tr>
                  );
                })}
                {!loading && leads.length === 0 && (
                  <TableEmpty
                    colSpan={9}
                    icon={Search}
                    title="No leads match these filters."
                    actions={
                      filtered && (
                        <Button variant="ghost" size="sm" onClick={() => setF({})}>
                          Clear filters
                        </Button>
                      )
                    }
                  />
                )}
              </tbody>
            </table>
          </TableFrame>
        )}
        {next && <NextPage onClick={more} />}
      </div>
      {open && (
        <LeadDrawer
          key={open.id}
          lead={open}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onChanged={refetch}
        />
      )}
    </div>
  );
}
