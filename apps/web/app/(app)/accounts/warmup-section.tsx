"use client";

import type { WarmupDay } from "@rightnow/core";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Callout } from "../../../components/callout";
import { pillFor, StatusPill, WARMUP } from "../../../components/status-pill";
import { Button } from "../../../components/ui/button";
import { Helper, Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Switch } from "../../../components/ui/switch";
import { call, errorText } from "./api-client";
import { isNumeric } from "./numeric";

type Settings = {
  enabled: boolean;
  dailyLimit: number;
  slowWarmup: boolean;
  startVolume: number;
  increasePerDay: number;
  replyRatePct: number;
  weekdaysOnly: boolean;
};
type View = { settings: Settings; state: string; peers: number; todayTarget: number };

const STATE: Record<string, string> = {
  PAUSED: "Paused",
  ACTIVE: "Active",
  PROVIDER_BLOCKED: "Blocked: the provider is not live-verified or the account needs attention",
  PLACEMENT_UNKNOWN: "Waiting for a second opted-in mailbox in this workspace",
  SUSPENDED: "Suspended: the account is disconnected",
};
// the B4.4 pill word of each state
const PILL: Record<string, string> = {
  PAUSED: "Paused",
  ACTIVE: "Active",
  PROVIDER_BLOCKED: "Blocked",
  PLACEMENT_UNKNOWN: "No peers",
  SUSPENDED: "Suspended",
};
const NUMBERS = [
  ["dailyLimit", "Warm-up messages per day", "Recommended 10 per day"],
  ["startVolume", "Warm-up first-day volume", ""],
  ["increasePerDay", "Warm-up increase per day", ""],
  ["replyRatePct", "Warm-up reply rate (%)", ""],
] as const;
const FLAGS = [
  ["enabled", "Enable warm-up"],
  ["slowWarmup", "Ramp up warm-up volume"],
  ["weekdaysOnly", "Warm up on weekdays only"],
] as const;
// B4.16 stacked warm-up bars: inbox success, spam danger, not found neutral (placement measured once per message)
const SERIES = [
  ["inbox", "Inbox", "var(--success-solid)"],
  ["spam", "Spam", "var(--danger-solid)"],
  ["missing", "Not found", "var(--neutral-solid)"],
] as const;

/** PS-WARM-01..13, -21: cooperative warm-up settings, state, 30-day stats and what it does and does not do (D36). */
export function WarmupSection({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [days, setDays] = useState<WarmupDay[]>([]);
  const [msg, setMsg] = useState("");
  const url = `/api/v1/accounts/${accountId}/warmup`;

  const load = (v: View) => {
    setView(v);
    setForm({
      ...Object.fromEntries(FLAGS.map(([k]) => [k, v.settings[k]])),
      ...Object.fromEntries(NUMBERS.map(([k]) => [k, String(v.settings[k])])),
    });
  };
  useEffect(() => {
    void call(url, "GET").then((r) => r.ok && load(r.json as unknown as View));
    void call(`${url}/stats?days=30`, "GET").then(
      (r) => r.ok && setDays(r.json.days as WarmupDay[]),
    );
  }, [url]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    for (const [k] of FLAGS) patch[k] = form[k];
    for (const [k, label] of NUMBERS) {
      if (!isNumeric(form[k] as string)) return setMsg(`${label}: enter a number.`);
      patch[k] = Number(form[k]);
    }
    setMsg("Saving...");
    const r = await call(url, "PATCH", patch);
    if (!r.ok) return setMsg(errorText(r));
    load(r.json as unknown as View);
    setMsg(
      (r.json.warnings as string[]).includes("slow_warmup_off_new_account")
        ? "Applied. Warning: turning the ramp off on an account younger than 2 weeks risks its reputation."
        : "Applied.",
    );
  }
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const active = days.filter((d) => d.sent || d.received);
  const pill = view && (view.settings.enabled ? (PILL[view.state] ?? "Paused") : "Off");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-sm font-semibold">Warm-up</h3>
        {pill && <StatusPill {...pillFor(WARMUP, pill)}>{pill}</StatusPill>}
      </div>
      {view && (
        <p>
          State: {STATE[view.state]}. Today&apos;s target: {view.todayTarget}. Opted-in peers:{" "}
          {view.peers}.
        </p>
      )}
      <p className="text-fg-muted">
        Plan for 30 campaign emails and 10 warm-up emails per account per day, and warm up new
        accounts for at least 2 weeks.
      </p>
      {view && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="flex flex-col">
            {FLAGS.map(([k, label]) => (
              <Switch
                key={k}
                label={label}
                disabled={!canEdit}
                checked={form[k] as boolean}
                onChange={(e) => set(k, e.target.checked)}
              />
            ))}
          </div>
          {form.slowWarmup === false && (
            <Callout tone="warning">
              Turning the ramp off on an account younger than 2 weeks risks its reputation.
            </Callout>
          )}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {NUMBERS.map(([k, label, help]) => (
              <div key={k} className="flex flex-col gap-1.5">
                <Label htmlFor={`w-${k}`}>{label}</Label>
                <Input
                  id={`w-${k}`}
                  type="number"
                  min={0}
                  disabled={!canEdit}
                  aria-describedby={help ? `wh-${k}` : undefined}
                  value={form[k] as string}
                  onChange={(e) => set(k, e.target.value)}
                />
                {help && <Helper id={`wh-${k}`}>{help}</Helper>}
              </div>
            ))}
          </div>
          {canEdit && (
            <div>
              <Button type="submit" variant="outline">
                Apply warm-up settings
              </Button>
            </div>
          )}
        </form>
      )}
      <p aria-live="polite">{msg}</p>
      {active.length > 0 && (
        <figure className="flex flex-col gap-2">
          <figcaption className="flex flex-wrap items-center gap-3 text-[13px]/[18px]">
            <span className="font-medium">Where warm-up mail landed, last 30 days</span>
            {SERIES.map(([, label, color]) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-fg-muted">
                <span aria-hidden className="size-2" style={{ background: color }} />
                {label}
              </span>
            ))}
          </figcaption>
          <div
            role="img"
            aria-label={`Warm-up placement per day: ${active.map((d) => `${d.day}: ${d.inbox} inbox, ${d.spam} spam, ${d.missing} not found`).join("; ")}`}
            className="h-40"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                  tickFormatter={(d: string) =>
                    new Date(`${d}T00:00:00Z`).toLocaleDateString("en", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })
                  }
                  minTickGap={24}
                />
                <YAxis
                  width={32}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: "var(--hover)" }}
                  contentStyle={{
                    background: "var(--surface-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                />
                {SERIES.map(([key, label, color], i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={label}
                    stackId="w"
                    fill={color}
                    maxBarSize={24}
                    radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : undefined}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      )}
      <details className="text-[13px]/[18px]">
        <summary className="cursor-pointer text-signal">Show as table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <caption className="text-left font-medium">Last 30 days</caption>
          <thead>
            <tr className="text-fg-muted">
              {["Day", "Sent", "Received", "Replied", "Inbox", "Spam", "Missing"].map((h) => (
                <th key={h} scope="col" className="py-1 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.length === 0 ? (
              <tr>
                <td colSpan={7}>No warm-up activity yet.</td>
              </tr>
            ) : (
              active.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="py-1">{d.day}</td>
                  <td>{d.sent}</td>
                  <td>{d.received}</td>
                  <td>{d.replied}</td>
                  <td>{d.inbox}</td>
                  <td>{d.spam}</td>
                  <td>{d.missing}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </details>
      <Callout tone="neutral" title="What warm-up does">
        <ul className="list-disc pl-5">
          <li>
            Sends short plain-text messages between mailboxes of this workspace that you opted in,
            08:00-20:00 account time, at least 10 minutes apart.
          </li>
          <li>
            Says what it is: every message is labelled automated warm-up mail from this
            installation.
          </li>
          <li>
            Replies to a share of received messages (the reply rate of the receiving mailbox) and
            measures once where each message landed.
          </li>
        </ul>
        <p className="mt-2 font-medium">What warm-up does not do</p>
        <ul className="list-disc pl-5">
          <li>
            It never opens, reads, stars, marks important, archives or deletes mail, and never moves
            mail out of spam or marks it &quot;not spam&quot;.
          </li>
          <li>It never spins or randomises message content to evade filters.</li>
          <li>
            It never mails addresses outside your opted-in mailboxes and never joins a third-party
            pool.
          </li>
          <li>
            Not provided: read emulation, open-rate targets, spam protection and mark-important.
            Reply rate is a cooperative-mailbox action.
          </li>
        </ul>
      </Callout>
    </div>
  );
}
