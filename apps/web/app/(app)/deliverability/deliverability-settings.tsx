"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Helper, Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";

/** B4.2 settings row: label + helper on the left, control on the right; stacked below 768. */
function Row({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border py-3.5 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="flex flex-col gap-1 md:max-w-1/2">
        <Label htmlFor={id}>{label}</Label>
        {help && <Helper id={`${id}-help`}>{help}</Helper>}
      </div>
      <div className="md:w-60 md:shrink-0">{children}</div>
    </div>
  );
}

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
    <Card className="max-w-3xl">
      <form onSubmit={save} className="flex flex-col">
        <h2 className="pb-4 text-base font-semibold">Deliverability settings</h2>
        <Row id="inactivityDays" label="Inactive after (days without a campaign send)">
          <Select
            id="inactivityDays"
            name="inactivityDays"
            defaultValue={v.inactivityDays}
            className="w-full"
          >
            {[7, 14, 30, 60].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </Select>
        </Row>
        <Row id="autoRewarm" label="When an account becomes inactive">
          <Select id="autoRewarm" name="autoRewarm" defaultValue={v.autoRewarm} className="w-full">
            <option value="AUTO">Start a re-warm automatically</option>
            <option value="RECOMMEND">Stop sending and recommend a re-warm</option>
            <option value="OFF">Do nothing</option>
          </Select>
        </Row>
        <Row
          id="bounceThresholdPct"
          label="Pause at a hard bounce rate above (%)"
          help="Pauses an account (after at least 50 accepted sends in 7 days) and campaigns with BounceProtect. Between 0.5 and 20, default 3."
        >
          <Input
            id="bounceThresholdPct"
            name="bounceThresholdPct"
            type="number"
            min={0.5}
            max={20}
            step={0.5}
            defaultValue={v.bounceThresholdPct}
            aria-describedby="bounceThresholdPct-help"
            required
          />
        </Row>
        <Row
          id="healthSlowdownPct"
          label="Share of the allowance kept when health slows an account (%)"
          help="Between 10 and 90, default 50."
        >
          <Input
            id="healthSlowdownPct"
            name="healthSlowdownPct"
            type="number"
            min={10}
            max={90}
            step={1}
            defaultValue={v.healthSlowdownPct}
            aria-describedby="healthSlowdownPct-help"
            required
          />
        </Row>
        <Row id="rewarmExitCleanDays" label="Clean days before a re-warm ends">
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
        </Row>
        <Row
          id="rewarmExitBouncePct"
          label="Hard bounce rate that keeps a re-warm going (%)"
          help="A re-warm ends only when the clean days stay at or under this rate. Between 0.5 and 10, default 2."
        >
          <Input
            id="rewarmExitBouncePct"
            name="rewarmExitBouncePct"
            type="number"
            min={0.5}
            max={10}
            step={0.5}
            defaultValue={v.rewarmExitBouncePct}
            aria-describedby="rewarmExitBouncePct-help"
            required
          />
        </Row>
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button type="submit">Save</Button>
          <p role="status" className="text-sm">
            {msg}
          </p>
        </div>
      </form>
    </Card>
  );
}
