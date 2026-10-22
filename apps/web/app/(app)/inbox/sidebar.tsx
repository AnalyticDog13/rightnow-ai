"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { call, errorText } from "../accounts/api-client";
import { INTEREST } from "../leads/labels";
import type { Filter } from "./types";

const VIEWS = [
  ["primary", "Primary"],
  ["others", "Others"],
  ["unread", "Unread"],
  ["reminders", "Reminders"],
  ["sent", "Sent"],
  ["scheduled", "Scheduled"],
  ["all", "All"],
] as const;
type Opt = { id: string; name?: string; email?: string };
type Saved = { id: string; name: string; filters: Record<string, unknown> };
const sel = "h-10 w-full rounded-md border border-border bg-card px-3 text-sm";

export function Sidebar({
  filter,
  counts,
  canEdit,
  onFilter,
}: {
  filter: Filter;
  counts: { primary: number; others: number; total: number; remindersDue: number };
  canEdit: boolean;
  onFilter: (f: Filter) => void;
}) {
  const [accounts, setAccounts] = useState<Opt[]>([]);
  const [campaigns, setCampaigns] = useState<Opt[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const loadSaved = () =>
    call("/api/v1/inbox/views", "GET").then((r) => setSaved((r.json.views as Saved[]) ?? []));
  useEffect(() => {
    void call("/api/v1/accounts", "GET").then((r) => setAccounts((r.json.accounts as Opt[]) ?? []));
    void call("/api/v1/campaigns", "GET").then((r) =>
      setCampaigns((r.json.campaigns as Opt[]) ?? []),
    );
    void loadSaved();
  }, []);

  const badge: Record<string, number> = {
    primary: counts.primary,
    others: counts.others,
    unread: counts.total,
    reminders: counts.remindersDue,
  };
  const set = (patch: Partial<Filter>) => onFilter({ ...filter, ...patch });

  async function save() {
    const { view, accountId, campaignId, interestStatus, q, hasAttachment } = filter;
    const r = await call("/api/v1/inbox/views", "POST", {
      name,
      filters: { view, accountId, campaignId, interestStatus, q, hasAttachment },
    });
    setErr(r.ok ? "" : errorText(r));
    if (r.ok) {
      setName("");
      void loadSaved();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Inbox views">
        <ul className="flex flex-col gap-1">
          {VIEWS.map(([id, label]) => (
            <li key={id}>
              <button
                type="button"
                aria-current={filter.view === id ? "true" : undefined}
                onClick={() => set({ view: id })}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary",
                  filter.view === id && "bg-muted text-primary",
                )}
              >
                {label}
                {(badge[id] ?? 0) > 0 && (
                  <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">
                    {badge[id]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs">
          Mailbox
          <select
            className={sel}
            value={filter.accountId ?? ""}
            onChange={(e) => set({ accountId: e.target.value || undefined })}
          >
            <option value="">All mailboxes</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Campaign
          <select
            className={sel}
            value={filter.campaignId ?? ""}
            onChange={(e) => set({ campaignId: e.target.value || undefined })}
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Lead status
          <select
            className={sel}
            value={filter.interestStatus ?? ""}
            onChange={(e) =>
              set({ interestStatus: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          >
            <option value="">Any status</option>
            {Object.entries(INTEREST).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">Saved views</h3>
        <ul className="flex flex-col gap-1">
          {saved.map((v) => (
            <li key={v.id} className="flex items-center gap-1">
              <button
                type="button"
                className="flex-1 truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => onFilter({ view: "primary", ...(v.filters as Partial<Filter>) })}
              >
                {v.name}
              </button>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Delete saved view ${v.name}`}
                  className="rounded px-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => void call(`/api/v1/inbox/views/${v.id}`, "DELETE").then(loadSaved)}
                >
                  x
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <>
            <Input
              aria-label="Saved view name"
              placeholder="Name this view"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button variant="outline" disabled={!name.trim()} onClick={() => void save()}>
              Save current view
            </Button>
            {err && (
              <p role="alert" className="text-sm text-red-600">
                {err}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
