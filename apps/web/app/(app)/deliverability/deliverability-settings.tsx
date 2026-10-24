"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";

const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

/** Workspace settings behind the dashboard: PATCH /settings/workspace (ADMIN, session only). */
export function DeliverabilitySettings(v: {
  inactivityDays: number;
  autoRewarm: string;
  bounceThresholdPct: number;
  healthSlowdownPct: number;
  rewarmExitCleanDays: number;
  rewarmExitBouncePct: number;
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
        inactivityDays: Number(f.get("inactivityDays")),
        autoRewarm: f.get("autoRewarm"),
        bounceThresholdPct: Number(f.get("bounceThresholdPct")),
        healthSlowdownPct: Number(f.get("healthSlowdownPct")),
        rewarmExitCleanDays: Number(f.get("rewarmExitCleanDays")),
        rewarmExitBouncePct: Number(f.get("rewarmExitBouncePct")),
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(res.ok ? "Saved." : (j.error ?? "Request failed"));
    if (res.ok) router.refresh();
  }

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Deliverability settings</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inactivityDays">Inactive after (days without a campaign send)</Label>
          <select
            id="inactivityDays"
            name="inactivityDays"
            defaultValue={v.inactivityDays}
            className={sel}
          >
            {[7, 14, 30, 60].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="autoRewarm">When an account becomes inactive</Label>
          <select id="autoRewarm" name="autoRewarm" defaultValue={v.autoRewarm} className={sel}>
            <option value="AUTO">Start a re-warm automatically</option>
            <option value="RECOMMEND">Stop sending and recommend a re-warm</option>
            <option value="OFF">Do nothing</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bounceThresholdPct">Pause at a hard bounce rate above (%)</Label>
          <Input
            id="bounceThresholdPct"
            name="bounceThresholdPct"
            type="number"
            min={0.5}
            max={20}
            step={0.5}
            defaultValue={v.bounceThresholdPct}
            required
          />
          <p className="text-xs text-muted-foreground">
            Pauses an account (after at least 50 accepted sends in 7 days) and campaigns with
            BounceProtect. Between 0.5 and 20, default 3.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="healthSlowdownPct">
            Share of the allowance kept when health slows an account (%)
          </Label>
          <Input
            id="healthSlowdownPct"
            name="healthSlowdownPct"
            type="number"
            min={10}
            max={90}
            step={1}
            defaultValue={v.healthSlowdownPct}
            required
          />
          <p className="text-xs text-muted-foreground">Between 10 and 90, default 50.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rewarmExitCleanDays">Clean days before a re-warm ends</Label>
          <Input
            id="rewarmExitCleanDays"
            name="rewarmExitCleanDays"
            type="number"
            min={1}
            max={30}
            step={1}
            defaultValue={v.rewarmExitCleanDays}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rewarmExitBouncePct">
            Hard bounce rate that keeps a re-warm going (%)
          </Label>
          <Input
            id="rewarmExitBouncePct"
            name="rewarmExitBouncePct"
            type="number"
            min={0.5}
            max={10}
            step={0.5}
            defaultValue={v.rewarmExitBouncePct}
            required
          />
          <p className="text-xs text-muted-foreground">
            A re-warm ends only when the clean days stay at or under this rate. Between 0.5 and 10,
            default 2.
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
