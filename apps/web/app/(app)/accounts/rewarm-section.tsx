"use client";

import type { ApiAccount } from "@rightnow/core";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call, errorText } from "./api-client";
import { isNumeric } from "./numeric";

type Finding = { level: string; reason: string; fix?: string };

/** PS-REWARM-03/05/10/11: the re-warm plan, or the form that starts one; "Resume at full volume" for an inactive account. */
export function RewarmSection({
  account,
  canEdit,
  onChanged,
}: {
  account: ApiAccount;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [start, setStart] = useState("5");
  const [step, setStep] = useState("2");
  const [withWarmup, setWithWarmup] = useState(false);
  const [msg, setMsg] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const url = `/api/v1/accounts/${account.id}/rewarm`;
  const plan = account.rewarm;
  const canStart = canEdit && !plan && ["ACTIVE", "INACTIVE"].includes(account.lifecycle);

  async function begin() {
    if (!isNumeric(start) || !isNumeric(step)) return setMsg("Enter numbers for both values.");
    if (
      !confirm(
        `Re-warm ${account.email}? Campaign sending restarts at ${start} per day and grows by ${step} per sending day up to the daily limit (${account.dailyLimit}). The connection and the domain's DNS are checked first.`,
      )
    )
      return;
    setMsg("Checking the connection and DNS...");
    const r = await call(url, "POST", {
      startVolume: Number(start),
      incrementPerDay: Number(step),
      withWarmup,
    });
    const found = (r.json.issues ?? r.json.warnings ?? []) as Finding[];
    const checks = (r.json.checks ?? []) as { name: string; ok: boolean; code?: string }[];
    setNotes([
      ...found.map((f) => `${f.reason}${f.fix ? ` Fix: ${f.fix}` : ""}`),
      ...checks.filter((c) => !c.ok).map((c) => `${c.name} failed${c.code ? ` (${c.code})` : ""}`),
    ]);
    setMsg(
      r.ok
        ? found.length
          ? "Re-warm started. DNS warnings:"
          : "Re-warm started."
        : r.json.error === "rewarm_blocked"
          ? "Not started: the domain's DNS blocks sending."
          : r.json.error === "reconnect_required"
            ? "Not started: reconnect the account first."
            : errorText(r),
    );
    if (r.ok) onChanged();
  }
  async function act(method: "DELETE" | "POST", path: string, done: string) {
    const r = await call(path, method, method === "POST" ? {} : undefined);
    setNotes([]);
    setMsg(r.ok ? done : errorText(r));
    if (r.ok) onChanged();
  }

  return (
    <section
      aria-label="Re-warm"
      className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm"
    >
      <h3 className="font-medium">Re-warm</h3>
      <p>
        Last campaign send {account.idleDays} day{account.idleDays === 1 ? "" : "s"} ago.
      </p>
      {plan && (
        <>
          <p>
            Re-warming: {plan.allowance} of {plan.target} emails per day, about{" "}
            {plan.estimatedDaysLeft} sending day{plan.estimatedDaysLeft === 1 ? "" : "s"} left (
            {plan.label}).
          </p>
          <progress
            aria-label="Re-warm progress"
            max={100}
            value={plan.progressPct}
            className="w-full"
          />
          {canEdit && (
            <div>
              <Button variant="outline" onClick={() => act("DELETE", url, "Re-warm cancelled.")}>
                Cancel re-warm
              </Button>
            </div>
          )}
        </>
      )}
      {account.lifecycle === "INACTIVE" && (
        <p>Inactive: no campaign mail is sent until you re-warm it or resume at full volume.</p>
      )}
      {canStart && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="rw-start">Re-warm start volume (per day)</Label>
            <Input
              id="rw-start"
              type="number"
              min={1}
              max={50}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rw-step">Re-warm increase per sending day</Label>
            <Input
              id="rw-step"
              type="number"
              min={1}
              max={20}
              value={step}
              onChange={(e) => setStep(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={withWarmup}
              onChange={(e) => setWithWarmup(e.target.checked)}
            />
            Also warm up with my other mailboxes (opted-in mailboxes of this workspace)
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button variant="outline" onClick={begin}>
              Re-warm
            </Button>
            {account.lifecycle === "INACTIVE" && (
              <Button
                variant="outline"
                onClick={() =>
                  act(
                    "POST",
                    `/api/v1/accounts/${account.id}/resume-full`,
                    "Resumed at full volume.",
                  )
                }
              >
                Resume at full volume
              </Button>
            )}
          </div>
        </div>
      )}
      <p aria-live="polite">{msg}</p>
      {notes.length > 0 && (
        <ul className="list-disc pl-5">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
