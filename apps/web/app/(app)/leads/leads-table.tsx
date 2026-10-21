"use client";

import type { ApiLead } from "@rightnow/core";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "../accounts/api-client";
import { BulkBar, type Member, type Named } from "./bulk-bar";
import { ImportWizard } from "./import-wizard";
import { ESP, INTEREST, REASON, VERIFICATION } from "./labels";
import { LeadDrawer } from "./lead-drawer";

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
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";
const fullName = (l: { firstName: string | null; lastName: string | null }) =>
  [l.firstName, l.lastName].filter(Boolean).join(" ");

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
  const [f, setF] = useState<Filters>(initialListId ? { listId: initialListId } : {});
  const [bounced, setBounced] = useState(false);
  const [leads, setLeads] = useState<ApiLead[]>([]);
  const [rows, setRows] = useState<Bounced[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
      if (bounced) {
        p.set("reason", "HARD_BOUNCE");
        p.set("kind", "EMAIL");
      }
      if (cursor) p.set("cursor", cursor);
      return `${bounced ? "/api/v1/blocklist" : "/api/v1/leads"}?${p}`;
    },
    [f, bounced],
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
    const r = await call(`/api/v1/blocklist/${b.id}`, "DELETE");
    setMsg(r.ok ? "Removed from the blocklist." : errorText(r));
    setTick((n) => n + 1);
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search leads"
          placeholder="Search email, name or company"
          className="max-w-xs"
          value={f.q ?? ""}
          onChange={(e) => set("q", e.target.value)}
        />
        <select
          aria-label="Filter by verification"
          className={sel}
          value={f.verificationStatus ?? ""}
          onChange={(e) => set("verificationStatus", e.target.value)}
        >
          <option value="">All verification</option>
          {Object.entries(VERIFICATION)
            .filter(([k]) => k !== "PENDING_JOB")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
        <select
          aria-label="Filter by interest"
          className={sel}
          value={f.interestStatus ?? ""}
          onChange={(e) => set("interestStatus", e.target.value)}
        >
          <option value="">All interest</option>
          {Object.entries(INTEREST).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by list"
          className={sel}
          value={f.listId ?? ""}
          onChange={(e) => set("listId", e.target.value)}
        >
          <option value="">All lists</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <Button
          variant={bounced ? "default" : "outline"}
          aria-pressed={bounced}
          onClick={() => setBounced((b) => !b)}
        >
          Bounced
        </Button>
        {canEdit && <ImportWizard lists={lists} onDone={() => setTick((n) => n + 1)} />}
        <Button asChild variant="outline">
          <a
            href={`/api/v1/leads/export?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`}
            download="leads.csv"
          >
            Export filtered
          </a>
        </Button>
      </div>
      {!bounced && (
        <details className="text-sm">
          <summary className="cursor-pointer">More filters</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              aria-label="Filter by tag"
              placeholder="Tag"
              className="max-w-32"
              value={f.tag ?? ""}
              onChange={(e) => set("tag", e.target.value)}
            />
            <select
              aria-label="Filter by label"
              className={sel}
              value={f.label ?? ""}
              onChange={(e) => set("label", e.target.value)}
            >
              <option value="">All labels</option>
              {labels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <select
              aria-label="Filter by owner"
              className={sel}
              value={f.ownerId ?? ""}
              onChange={(e) => set("ownerId", e.target.value)}
            >
              <option value="">Any owner</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={f.openedNoReply === "true"}
                onChange={(e) => set("openedNoReply", e.target.checked ? "true" : "")}
              />
              Opened, no reply
            </label>
            <label className="flex items-center gap-1">
              Last contacted from
              <Input
                type="date"
                className="w-40"
                value={f.lastContactedFrom ?? ""}
                onChange={(e) => set("lastContactedFrom", e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1">
              to
              <Input
                type="date"
                className="w-40"
                value={f.lastContactedTo ?? ""}
                onChange={(e) => set("lastContactedTo", e.target.value)}
              />
            </label>
            <Input
              aria-label="Custom field name"
              placeholder="Custom field"
              className="max-w-36"
              value={f.customKey ?? ""}
              onChange={(e) => set("customKey", e.target.value)}
            />
            <Input
              aria-label="Custom field contains"
              placeholder="contains"
              className="max-w-36"
              value={f.customContains ?? ""}
              onChange={(e) => set("customContains", e.target.value)}
            />
          </div>
        </details>
      )}
      {canEdit && !bounced && selected.size > 0 && (
        <BulkBar
          ids={[...selected]}
          emails={leads.filter((l) => selected.has(l.id)).map((l) => l.email)}
          lists={lists}
          members={members}
          fromListId={f.listId ?? ""}
          isAdmin={isAdmin}
          onDone={(m) => {
            setMsg(m);
            setTick((n) => n + 1);
          }}
        />
      )}
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {loading
          ? "Loading…"
          : `Showing ${shown}${total === null ? "" : ` of ${total}`} ${bounced ? "bounced addresses" : "leads"}`}
      </p>
      <Card className="overflow-x-auto p-0">
        {bounced ? (
          <table aria-label="Bounced leads" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Email", "Name", "Company", "Reason", "Added", "Actions"].map((h) => (
                  <th key={h} className="p-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-border">
                  <td className="p-3">{b.value}</td>
                  <td className="p-3">{b.lead ? fullName(b.lead) : ""}</td>
                  <td className="p-3">{b.lead?.companyName}</td>
                  <td className="p-3">
                    {REASON[b.reason]}
                    {b.source ? ` (${b.source})` : ""}
                  </td>
                  <td className="p-3">{b.createdAt.slice(0, 10)}</td>
                  <td className="p-3">
                    {isAdmin && (
                      <Button
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        aria-label={`Remove ${b.value} from the blocklist`}
                        onClick={() => removeSuppression(b)}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No bounced addresses.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table aria-label="Leads" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    aria-label="Select all leads"
                    checked={allOn}
                    disabled={!canEdit || ids.length === 0}
                    onChange={() => setSelected(allOn ? new Set() : new Set(ids))}
                  />
                </th>
                {["Email", "Name", "Company", "Interest", "Verification", "ESP"].map((h) => (
                  <th key={h} className="p-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr
                  key={l.id}
                  tabIndex={0}
                  aria-selected={selected.has(l.id)}
                  className="cursor-pointer border-b border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => setOpenId(l.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setOpenId(l.id);
                    }
                  }}
                >
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${l.email}`}
                      checked={selected.has(l.id)}
                      disabled={!canEdit}
                      onChange={() => toggle(l.id)}
                    />
                  </td>
                  <td className="p-3">{l.email}</td>
                  <td className="p-3">{fullName(l)}</td>
                  <td className="p-3">
                    {l.interestStatus !== null && (
                      <span className="inline-block rounded-full border border-border px-2 py-0.5 text-xs">
                        {INTEREST[String(l.interestStatus)]}
                      </span>
                    )}
                  </td>
                  <td className="p-3">{VERIFICATION[l.verificationStatus]}</td>
                  <td className="p-3">{ESP[l.espType]}</td>
                </tr>
              ))}
              {!loading && leads.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    {Object.values(f).some(Boolean)
                      ? "No leads match."
                      : "No leads yet. Import a CSV to start."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
      {next && (
        <Button variant="outline" className="self-start" onClick={more}>
          Load more
        </Button>
      )}
      {open && (
        <LeadDrawer
          key={open.id}
          lead={open}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onChanged={() => setTick((n) => n + 1)}
        />
      )}
    </div>
  );
}
