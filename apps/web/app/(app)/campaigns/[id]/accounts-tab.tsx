"use client";

import type { DisplayStatus } from "@rightnow/core";
import { Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CapacityBar } from "../../../../components/send-meter";
import { ACCOUNT_STATUS, pillFor, StatusPill } from "../../../../components/status-pill";
import { TableEmpty, TableFrame } from "../../../../components/table-kit";
import { Button } from "../../../../components/ui/button";
import { Helper, Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { STATUS_LABEL } from "../../accounts/account-status";
import { call, errorText } from "../../accounts/api-client";
import type { AccountView, CampaignView } from "./campaign-builder";

const label = (s: string) =>
  s === "DISCONNECTED" ? "Disconnected" : (STATUS_LABEL[s as DisplayStatus] ?? s);

export function AccountsTab({
  campaignId,
  campaign,
  accounts,
  canEdit,
  onChange,
}: {
  campaignId: string;
  campaign: CampaignView;
  accounts: AccountView[];
  canEdit: boolean;
  onChange: () => void;
}) {
  const [picked, setPicked] = useState(new Set(campaign.accounts.map((a) => a.accountId)));
  const [tags, setTags] = useState(campaign.accountTags.join(", "));
  const [msg, setMsg] = useState("");

  async function save() {
    const a = await call(`/api/v1/campaigns/${campaignId}/accounts`, "PUT", {
      accountIds: [...picked],
    });
    if (!a.ok) return setMsg(errorText(a));
    const t = await call(`/api/v1/campaigns/${campaignId}`, "PATCH", {
      accountTags: tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    });
    setMsg(t.ok ? "Accounts saved." : errorText(t));
    if (t.ok) onChange();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <legend className="sr-only">Sending accounts</legend>
        <p className="text-[13px]/[18px] text-fg-muted">
          Tick the mailboxes this campaign may send from; a tag filter below narrows them further.
        </p>
        <TableFrame>
          <table aria-label="Sending accounts">
            <thead>
              <tr>
                <th scope="col" data-pin="check" className="w-11">
                  <span className="sr-only">Use</span>
                </th>
                <th scope="col" data-pin="id">
                  Account
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="hidden md:table-cell">
                  Today
                </th>
                <th scope="col" className="hidden md:table-cell">
                  Tags
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const l = label(a.status);
                const spec = pillFor(ACCOUNT_STATUS, l);
                return (
                  <tr key={a.id} aria-selected={picked.has(a.id)}>
                    <td data-pin="check">
                      <input
                        type="checkbox"
                        id={`acct-${a.id}`}
                        checked={picked.has(a.id)}
                        onChange={(e) =>
                          setPicked((o) => {
                            const n = new Set(o);
                            if (e.target.checked) n.add(a.id);
                            else n.delete(a.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td data-pin="id" className="max-w-56">
                      <label
                        htmlFor={`acct-${a.id}`}
                        className="block cursor-pointer truncate font-medium"
                        title={a.email}
                      >
                        {a.email}
                      </label>
                    </td>
                    <td>
                      <StatusPill {...spec}>{l}</StatusPill>
                    </td>
                    <td className="hidden whitespace-nowrap tabular-nums md:table-cell">
                      {a.sentToday} / {a.capacity}
                      <CapacityBar sent={a.sentToday} max={a.capacity} className="mt-1 w-16" />
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
                  </tr>
                );
              })}
              {accounts.length === 0 && (
                <TableEmpty
                  colSpan={5}
                  icon={Mail}
                  title="No sending accounts assigned."
                  actions={
                    <Button asChild variant="link">
                      <Link href="/accounts">Connect account</Link>
                    </Button>
                  }
                />
              )}
            </tbody>
          </table>
        </TableFrame>
        <div className="flex max-w-md flex-col gap-1.5">
          <Label htmlFor="acct-tags">Only use accounts with these tags (comma separated)</Label>
          <Input
            id="acct-tags"
            value={tags}
            aria-describedby="acct-tags-help"
            onChange={(e) => setTags(e.target.value)}
          />
          <Helper id="acct-tags-help">Leave empty to use every assigned account.</Helper>
        </div>
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit">Save accounts</Button>
          <p role="status" className="text-sm">
            {msg}
          </p>
        </div>
      )}
    </form>
  );
}
