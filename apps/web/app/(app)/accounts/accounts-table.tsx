"use client";

import type { ApiAccount, DisplayStatus } from "@rightnow/core";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Pager, SortTh, TagSelect, usePage, useSort } from "../../../components/table-kit";
import { AccountDrawer } from "./account-drawer";
import { call, errorText } from "./api-client";
import { BulkBar } from "./bulk-bar";
import type { Provider } from "./connect-menu";

const PROVIDER = { GMAIL: "Google", MICROSOFT: "Microsoft", SMTP: "SMTP" } as const;
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  TEMP_PAUSED: "Paused until later",
  CONNECTION_ERROR: "Connection error",
  SOFT_BOUNCE_ERROR: "Soft bounce error",
  SENDING_ERROR: "Sending error",
  REWARMING: "Re-warming",
  INACTIVE: "Inactive",
  NEEDS_ATTENTION: "Needs attention",
};
const label = (a: ApiAccount) =>
  a.status === "DISCONNECTED" ? "Disconnected" : STATUS_LABEL[a.displayStatus];
const isGood = (a: ApiAccount) => a.status !== "DISCONNECTED" && a.displayStatus === "ACTIVE";

export function AccountsTable({
  accounts,
  canEdit,
  isAdmin,
  configured,
}: {
  accounts: ApiAccount[];
  canEdit: boolean;
  isAdmin: boolean;
  configured: Record<Provider, boolean>;
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
    status: (a) => label(a),
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
  const small = "h-8 px-2 text-xs";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search accounts"
          placeholder="Search email, name or tag"
          className="max-w-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Filter by status"
          className="h-10 rounded-md border border-border bg-card px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          {(Object.keys(STATUS_LABEL) as DisplayStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
          <option value="DISCONNECTED">Disconnected</option>
        </select>
        <TagSelect kind="account" value={tag} onChange={setTag} />
      </div>
      {canEdit && selected.size > 0 && (
        <BulkBar
          ids={[...selected]}
          names={Object.fromEntries(accounts.map((a) => [a.id, a.email]))}
          isAdmin={isAdmin}
          onDone={(text) => {
            setMsg(text);
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}
      <Card className="overflow-x-auto p-0">
        <table aria-label="Email accounts" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10 p-3">
                <input
                  type="checkbox"
                  aria-label="Select all accounts"
                  checked={allOn}
                  disabled={!canEdit || ids.length === 0}
                  onChange={() => setSelected(allOn ? new Set() : new Set(ids))}
                />
              </th>
              <SortTh col="email" sort={sort} onSort={sortBy}>
                Email
              </SortTh>
              <SortTh col="provider" sort={sort} onSort={sortBy}>
                Provider
              </SortTh>
              <SortTh col="status" sort={sort} onSort={sortBy}>
                Status
              </SortTh>
              <SortTh col="sent" sort={sort} onSort={sortBy}>
                Today: sent / limit / left
              </SortTh>
              <SortTh col="tags" sort={sort} onSort={sortBy}>
                Tags
              </SortTh>
              <th scope="col" className="p-3 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((a) => (
              <tr key={a.id} className="border-b border-border" aria-selected={selected.has(a.id)}>
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${a.email}`}
                    checked={selected.has(a.id)}
                    disabled={!canEdit}
                    onChange={() => toggle(a.id)}
                  />
                </td>
                <td className="p-3">
                  <div>{a.email}</div>
                  <div className="text-xs text-muted-foreground">{a.fromName}</div>
                </td>
                <td className="p-3">{PROVIDER[a.provider]}</td>
                <td className="p-3">
                  <span
                    title={(a.lastError as { message?: string } | null)?.message}
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs ${isGood(a) ? "border-border" : "border-destructive text-destructive"}`}
                  >
                    {label(a)}
                  </span>
                </td>
                <td className="p-3 tabular-nums">
                  {a.sentToday} / {a.dailyLimit} / {a.remainingToday}
                </td>
                <td className="p-3">{a.tags.join(", ")}</td>
                <td className="p-3">
                  {canEdit && (
                    <div className="flex flex-wrap gap-1">
                      {a.status !== "DISCONNECTED" && (
                        <Button
                          variant="outline"
                          className={small}
                          aria-label={`${a.lifecycle === "PAUSED" ? "Resume" : "Pause"} ${a.email}`}
                          onClick={() => act(a, a.lifecycle === "PAUSED" ? "resume" : "pause")}
                        >
                          {a.lifecycle === "PAUSED" ? "Resume" : "Pause"}
                        </Button>
                      )}
                      {!a.rewarm && (a.lifecycle === "INACTIVE" || a.lifecycle === "ACTIVE") && (
                        <Button
                          variant="outline"
                          className={small}
                          aria-label={`Re-warm ${a.email}`}
                          onClick={() => setOpenId(a.id)}
                        >
                          Re-warm
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className={small}
                        aria-label={`Limits for ${a.email}`}
                        onClick={() => setOpenId(a.id)}
                      >
                        Limits
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          className={small}
                          aria-label={`Reconnect ${a.email}`}
                          onClick={() => setOpenId(a.id)}
                        >
                          Reconnect
                        </Button>
                      )}
                      {isAdmin && a.status !== "DISCONNECTED" && (
                        <Button
                          variant="outline"
                          className={small}
                          aria-label={`Disconnect ${a.email}`}
                          onClick={() => act(a, "disconnect")}
                        >
                          Disconnect
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          variant="outline"
                          className={small}
                          aria-label={`Delete ${a.email}`}
                          onClick={() => act(a, "delete")}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {accounts.length === 0 ? "No email accounts yet." : "No accounts match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <Pager page={pager.page} pages={pager.pages} onPage={pager.setPage} />
      {open && (
        <AccountDrawer
          key={open.id}
          account={open}
          canEdit={canEdit}
          isAdmin={isAdmin}
          configured={configured}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
