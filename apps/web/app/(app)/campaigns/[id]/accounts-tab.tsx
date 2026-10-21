"use client";

import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { call, errorText } from "../../accounts/api-client";
import type { AccountView, CampaignView } from "./campaign-builder";

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
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-3">
        <legend className="sr-only">Sending accounts</legend>
        <Card className="flex flex-col gap-2 p-4">
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
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
              {a.email}
              <span className="text-xs text-muted-foreground">
                {a.status}
                {a.tags.length > 0 && ` · ${a.tags.join(", ")}`}
              </span>
            </label>
          ))}
          {accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">No email accounts connected yet.</p>
          )}
        </Card>
        <div className="flex flex-col gap-1">
          <label htmlFor="acct-tags" className="text-sm font-medium">
            Only use accounts with these tags (comma separated)
          </label>
          <Input
            id="acct-tags"
            className="max-w-md"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to use every assigned account.
          </p>
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
