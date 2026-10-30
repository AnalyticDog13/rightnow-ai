"use client";

import type { ApiAccount, DisplayStatus } from "@rightnow/core";
import {
  Flame,
  Pause,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Callout } from "../../../components/callout";
import { HealthRing } from "../../../components/health-ring";
import { CapacityBar } from "../../../components/send-meter";
import { ACCOUNT_STATUS, pillFor, StatusPill } from "../../../components/status-pill";
import { AccountPill, STATUS_LABEL, statusLabel } from "./account-status";
import {
  Pager,
  SearchInput,
  SortTh,
  TableEmpty,
  TableFrame,
  TagSelect,
  usePage,
  useSort,
} from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { AccountDrawer } from "./account-drawer";
import { call, errorText } from "./api-client";
import { BulkBar } from "./bulk-bar";
import type { Provider } from "./connect-menu";

const PROVIDER = { GMAIL: "Google", MICROSOFT: "Microsoft", SMTP: "SMTP" } as const;
/**
 * A row action: icon + short label. Six labelled actions do not fit next to the columns below 1536, so the label
 * collapses there (spec B4.6 says 1024); the aria-label names it and the title shows it on hover.
 */
function RowAction({
  icon: Icon,
  label,
  danger,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  "aria-label": string;
  onClick: () => void;
}) {
  return (
    <Button
      variant={danger ? "danger-ghost" : "ghost"}
      size="sm"
      className="max-2xl:w-8 max-2xl:px-0 max-md:w-11"
      title={label}
      {...props}
    >
      <Icon aria-hidden />
      <span className="max-2xl:sr-only">{label}</span>
    </Button>
  );
}

export function AccountsTable({
  accounts,
  canEdit,
  isAdmin,
  configured,
  staleAfterSec,
}: {
  accounts: ApiAccount[];
  canEdit: boolean;
  isAdmin: boolean;
  configured: Record<Provider, boolean>;
  staleAfterSec: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts.filter(
      (a) =>
        (status === "ALL" ||
          (status === "DISCONNECTED" ? a.status === "DISCONNECTED" : a.displayStatus === status)) &&
        (!tag || a.tags.includes(tag)) &&
        (!needle || [a.email, a.fromName, ...a.tags].some((s) => s.toLowerCase().includes(needle))),
    );
  }, [accounts, q, status, tag]);
  const {
    sorted,
    sort,
    toggle: sortBy,
  } = useSort(shown, {
    email: (a) => a.email.toLowerCase(),
    provider: (a) => a.provider,
    status: (a) => statusLabel(a),
    health: (a) => a.health.score,
    sent: (a) => a.sentToday,
    tags: (a) => a.tags.join(", ") || null,
  });
  const pager = usePage(sorted);
  const ids = pager.rows.map((a) => a.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const filtered = q !== "" || status !== "ALL" || tag !== "";

  async function act(a: ApiAccount, action: "pause" | "resume" | "disconnect" | "delete") {
    if (
      action === "disconnect" &&
      !confirm(`Disconnect ${a.email}? Sending stops until you reconnect.`)
    )
      return;
    if (
      action === "delete" &&
      !confirm(`Delete ${a.email}? It disappears from this list; sent history is kept.`)
    )
      return;
    const r =
      action === "delete"
        ? await call(`/api/v1/accounts/${a.id}`, "DELETE")
        : await call(`/api/v1/accounts/${a.id}/${action}`, "POST", {});
    setMsg(r.ok ? "" : `${a.email}: ${errorText(r)}`);
    router.refresh();
  }

  const open = accounts.find((a) => a.id === openId);
  return (
    <div className="flex flex-col gap-3">
      {canEdit && selected.size > 0 ? (
        <BulkBar
          ids={[...selected]}
          names={Object.fromEntries(accounts.map((a) => [a.id, a.email]))}
          isAdmin={isAdmin}
          onClear={() => setSelected(new Set())}
          onDone={(text) => {
            setMsg(text);
            setSelected(new Set());
            router.refresh();
          }}
        />
      ) : (
        <div className="flex min-h-12 flex-wrap items-center gap-2">
          <SearchInput
            aria-label="Search accounts"
            placeholder="Search email, name or tag"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            size="sm"
            aria-label="Filter by status"
            className="w-auto"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="ALL">All statuses</option>
            {(Object.keys(STATUS_LABEL) as DisplayStatus[]).map((s) => (
              <option key={s} value={s}>
                Status: {STATUS_LABEL[s]}
              </option>
            ))}
            <option value="DISCONNECTED">Status: Disconnected</option>
          </Select>
          <TagSelect kind="account" value={tag} onChange={setTag} />
          <span className="ml-auto text-[13px]/[18px] text-fg-muted tabular-nums">
            {shown.length} account{shown.length === 1 ? "" : "s"}
          </span>
        </div>
      )}
      {msg && (
        <Callout tone="danger" role="alert">
          {msg}
        </Callout>
      )}
      <TableFrame footer={<Pager page={pager.page} pages={pager.pages} onPage={pager.setPage} />}>
        <table aria-label="Email accounts">
          <thead>
            <tr>
              <th data-pin="check" className="w-11">
                <input
                  type="checkbox"
                  aria-label="Select all accounts"
                  checked={allOn}
                  disabled={!canEdit || ids.length === 0}
                  onChange={() => setSelected(allOn ? new Set() : new Set(ids))}
                />
              </th>
              <SortTh col="email" sort={sort} onSort={sortBy} data-pin="id">
                Email
              </SortTh>
              <SortTh col="provider" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Provider
              </SortTh>
              <SortTh col="status" sort={sort} onSort={sortBy}>
                Status
              </SortTh>
              <SortTh col="health" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Health
              </SortTh>
              <SortTh col="sent" sort={sort} onSort={sortBy}>
                Today: sent / limit / left
              </SortTh>
              <SortTh col="tags" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Tags
              </SortTh>
              <th scope="col" className="text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((a) => {
              const spec = pillFor(ACCOUNT_STATUS, statusLabel(a));
              return (
                <tr
                  key={a.id}
                  aria-selected={selected.has(a.id)}
                  data-stripe={
                    spec.tone === "danger" || spec.tone === "warning" ? spec.tone : undefined
                  }
                >
                  <td data-pin="check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.email}`}
                      checked={selected.has(a.id)}
                      disabled={!canEdit}
                      onChange={() => toggle(a.id)}
                    />
                  </td>
                  <td data-pin="id" className="max-w-56">
                    <div className="truncate font-medium" title={a.email}>
                      {a.email}
                    </div>
                    <div className="truncate text-[13px]/[18px] text-fg-subtle">{a.fromName}</div>
                  </td>
                  <td className="hidden md:table-cell">{PROVIDER[a.provider]}</td>
                  <td>
                    <AccountPill account={a} />
                  </td>
                  <td className="hidden md:table-cell">
                    <span className="flex items-center gap-2">
                      <HealthRing score={a.health.score} size={24} label="wide" />
                      {a.health.cap !== null && (
                        <StatusPill tone="warning" size="sm">
                          Throttled to {a.health.cap}/day
                        </StatusPill>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    <div>
                      {a.sentToday} / {a.dailyLimit} / {a.remainingToday}
                    </div>
                    <CapacityBar
                      sent={a.sentToday}
                      max={a.sentToday + a.reservedToday + a.remainingToday}
                      className="mt-1 w-16"
                    />
                  </td>
                  <td className="hidden md:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {a.tags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex h-5 items-center rounded-xs border border-border bg-sunken px-1.5 text-xs text-fg-muted"
                        >
                          {t}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="text-right">
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        {a.status !== "DISCONNECTED" && (
                          <RowAction
                            icon={a.lifecycle === "PAUSED" ? Play : Pause}
                            label={a.lifecycle === "PAUSED" ? "Resume" : "Pause"}
                            aria-label={`${a.lifecycle === "PAUSED" ? "Resume" : "Pause"} ${a.email}`}
                            onClick={() => act(a, a.lifecycle === "PAUSED" ? "resume" : "pause")}
                          />
                        )}
                        {!a.rewarm && (a.lifecycle === "INACTIVE" || a.lifecycle === "ACTIVE") && (
                          <RowAction
                            icon={Flame}
                            label="Re-warm"
                            aria-label={`Re-warm ${a.email}`}
                            onClick={() => setOpenId(a.id)}
                          />
                        )}
                        <RowAction
                          icon={SlidersHorizontal}
                          label="Limits"
                          aria-label={`Limits for ${a.email}`}
                          onClick={() => setOpenId(a.id)}
                        />
                        {isAdmin && (
                          <RowAction
                            icon={RefreshCw}
                            label="Reconnect"
                            aria-label={`Reconnect ${a.email}`}
                            onClick={() => setOpenId(a.id)}
                          />
                        )}
                        {isAdmin && a.status !== "DISCONNECTED" && (
                          <RowAction
                            icon={Unplug}
                            label="Disconnect"
                            danger
                            aria-label={`Disconnect ${a.email}`}
                            onClick={() => act(a, "disconnect")}
                          />
                        )}
                        {isAdmin && (
                          <RowAction
                            icon={Trash2}
                            label="Delete"
                            danger
                            aria-label={`Delete ${a.email}`}
                            onClick={() => act(a, "delete")}
                          />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <TableEmpty
                colSpan={8}
                icon={Search}
                title="No accounts match these filters."
                actions={
                  filtered && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQ("");
                        setStatus("ALL");
                        setTag("");
                      }}
                    >
                      Clear filters
                    </Button>
                  )
                }
              />
            )}
          </tbody>
        </table>
      </TableFrame>
      {open && (
        <AccountDrawer
          key={open.id}
          account={open}
          canEdit={canEdit}
          isAdmin={isAdmin}
          configured={configured}
          staleAfterSec={staleAfterSec}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
