"use client";

import type { WarmupDay } from "@rightnow/core";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
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
const NUMBERS = [
  ["dailyLimit", "Warm-up messages per day"],
  ["startVolume", "Warm-up first-day volume"],
  ["increasePerDay", "Warm-up increase per day"],
  ["replyRatePct", "Warm-up reply rate (%)"],
] as const;
const FLAGS = [
  ["enabled", "Enable warm-up"],
  ["slowWarmup", "Ramp up warm-up volume"],
  ["weekdaysOnly", "Warm up on weekdays only"],
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

  return (
    <section
      aria-label="Warm-up"
      className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm"
    >
      <h3 className="font-medium">Warm-up</h3>
      {view && (
        <p>
          State: {STATE[view.state]}. Today&apos;s target: {view.todayTarget}. Opted-in peers:{" "}
          {view.peers}.
        </p>
      )}
      <p className="text-muted-foreground">
        Plan for 30 campaign emails and 10 warm-up emails per account per day, and warm up new
        accounts for at least 2 weeks.
      </p>
      {view && (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          {FLAGS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={form[k] as boolean}
                onChange={(e) => set(k, e.target.checked)}
              />
              {label}
            </label>
          ))}
          {NUMBERS.map(([k, label]) => (
            <div key={k} className="flex flex-col gap-1">
              <Label htmlFor={`w-${k}`}>{label}</Label>
              <Input
                id={`w-${k}`}
                type="number"
                min={0}
                disabled={!canEdit}
                value={form[k] as string}
                onChange={(e) => set(k, e.target.value)}
              />
            </div>
          ))}
          {canEdit && (
            <div className="sm:col-span-2">
              <Button type="submit" variant="outline">
                Apply warm-up settings
              </Button>
            </div>
          )}
        </form>
      )}
      <p aria-live="polite">{msg}</p>
      <div>
        <h4 className="font-medium">What warm-up does</h4>
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
        <h4 className="mt-2 font-medium">What warm-up does not do</h4>
        <ul className="list-disc pl-5">
          <li>
            It never opens, reads, stars, marks important, archives or deletes mail, and never moves
            mail out of spam or marks it &quot;not spam&quot;.
          </li>
          <li>
            It never mails addresses outside your opted-in mailboxes and never joins a third-party
            pool.
          </li>
          <li>
            Not provided: read emulation, open-rate targets, spam protection and mark-important.
            Reply rate is a cooperative-mailbox action.
          </li>
        </ul>
      </div>
      <table className="w-full text-left">
        <caption className="text-left font-medium">Last 30 days</caption>
        <thead>
          <tr>
            {["Day", "Sent", "Received", "Replied", "Inbox", "Spam", "Missing"].map((h) => (
              <th key={h} scope="col">
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
              <tr key={d.day}>
                <td>{d.day}</td>
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
    </section>
  );
}
