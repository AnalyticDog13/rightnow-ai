"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const cap = (v: FormDataEntryValue | null) => (String(v).trim() === "" ? null : Number(v));

export function WorkspaceSettings({
  timezone,
  physicalAddress,
  dailyCap,
  perCompanyDailyLimit,
  disableOpenTracking,
  firstEmailTextOnly,
  storeNonLeadMail,
}: {
  timezone: string;
  physicalAddress: string;
  dailyCap: number | null;
  perCompanyDailyLimit: number | null;
  disableOpenTracking: boolean;
  firstEmailTextOnly: boolean;
  storeNonLeadMail: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/v1/settings/workspace", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timezone: f.get("timezone"),
        physicalAddress: f.get("physicalAddress"),
        dailyCap: cap(f.get("dailyCap")),
        perCompanyDailyLimit: cap(f.get("perCompanyDailyLimit")),
        disableOpenTracking: f.has("disableOpenTracking"),
        firstEmailTextOnly: f.has("firstEmailTextOnly"),
        storeNonLeadMail: f.has("storeNonLeadMail"),
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(res.ok ? "Saved." : (j.error ?? "Request failed"));
    if (res.ok) router.refresh();
  }

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Workspace</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone">Timezone (IANA name, e.g. Europe/Berlin)</Label>
          <Input id="timezone" name="timezone" defaultValue={timezone} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="physicalAddress">Physical postal address</Label>
          <Input
            id="physicalAddress"
            name="physicalAddress"
            defaultValue={physicalAddress}
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">
            Added to the footer of every campaign email (CAN-SPAM). Campaigns cannot launch or send
            while it is empty.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dailyCap">Daily send cap for all campaigns (empty = no cap)</Label>
          <Input
            id="dailyCap"
            name="dailyCap"
            type="number"
            min={1}
            defaultValue={dailyCap ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Recommended: about 30 per connected account per day.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="perCompanyDailyLimit">Daily emails per company (empty = no limit)</Label>
          <Input
            id="perCompanyDailyLimit"
            name="perCompanyDailyLimit"
            type="number"
            min={1}
            defaultValue={perCompanyDailyLimit ?? ""}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="disableOpenTracking" defaultChecked={disableOpenTracking} />
          Never track opens
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="firstEmailTextOnly" defaultChecked={firstEmailTextOnly} />
          Send the first email of every sequence as plain text
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="storeNonLeadMail" defaultChecked={storeNonLeadMail} />
          Save emails from non-leads
        </label>
        <p className="-mt-3 text-xs text-muted-foreground">
          When off, replies from people who are not leads and not in a known thread are not saved.
          Bounces and unsubscribes are always processed.
        </p>
        <div className="flex items-center gap-3">
          <Button type="submit">Save</Button>
          <p role="status" className="text-sm">
            {msg}
          </p>
        </div>
      </form>
    </Card>
  );
}
