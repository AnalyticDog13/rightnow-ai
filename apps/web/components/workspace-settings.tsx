"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function WorkspaceSettings({
  timezone,
  physicalAddress,
}: {
  timezone: string;
  physicalAddress: string;
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
