"use client";

import type { AccountDeliverability } from "@rightnow/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { call, errorText } from "../accounts/api-client";

const BADGE: Record<AccountDeliverability["status"], string> = {
  Active: "bg-green-100 text-green-900",
  Inactive: "bg-amber-100 text-amber-900",
  "Re-Warming": "bg-blue-100 text-blue-900",
  Paused: "bg-muted text-foreground",
  "Needs Attention": "bg-red-100 text-red-900",
};
const WARMUP: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  PROVIDER_BLOCKED: "Blocked",
  PLACEMENT_UNKNOWN: "No peers",
  SUSPENDED: "Suspended",
};

/** Score history as a line; the numbers are in the label for screen readers. */
function Sparkline({ trend }: { trend: { day: string; score: number }[] }) {
  if (trend.length < 2) return null;
  const step = 80 / (trend.length - 1);
  const pts = trend.map(
    (t, i) => `${(i * step).toFixed(1)},${(23 - (t.score / 100) * 22).toFixed(1)}`,
  );
  return (
    <svg
      role="img"
      aria-label={`Health score, last ${trend.length} days: ${trend.map((t) => t.score).join(", ")}`}
      viewBox="0 0 80 24"
      className="h-6 w-20"
    >
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function DeliverabilityTable({
  rows,
  canEdit,
}: {
  rows: AccountDeliverability[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  async function rewarm(r: AccountDeliverability) {
    if (
      !confirm(
        `Re-warm ${r.email}? Campaign sending restarts at 5 per day and grows by 2 per sending day up to ${r.target}. The connection and the domain's DNS are checked first.`,
      )
    )
      return;
    const res = await call(`/api/v1/accounts/${r.id}/rewarm`, "POST", {});
    setMsg(
      res.ok
        ? `Re-warm started for ${r.email}.`
        : res.json.error === "rewarm_blocked"
          ? `Not started: the DNS of ${r.email} blocks sending.`
          : errorText(res),
    );
    if (res.ok) router.refresh();
  }
  async function resumeFull(r: AccountDeliverability) {
    const res = await call(`/api/v1/accounts/${r.id}/resume-full`, "POST", {});
    setMsg(res.ok ? `${r.email} resumed at full volume.` : errorText(res));
    if (res.ok) router.refresh();
  }

  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        No email accounts yet.{" "}
        <Link className="underline" href="/accounts">
          Connect one
        </Link>
        .
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="text-sm">
        {msg}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-left text-sm">
          <caption className="sr-only">Deliverability per email account</caption>
          <thead>
            <tr>
              {[
                "Account",
                "Status",
                "Idle days",
                "Allowance",
                "Health",
                "Last 30 days",
                "DNS",
                "Warm-up",
                "Warnings",
                "Actions",
              ].map((h) => (
                <th key={h} scope="col" className="p-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <th scope="row" className="p-2 font-normal">
                  {r.email}
                </th>
                <td className="p-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${BADGE[r.status]}`}>
                    {r.status}
                  </span>
                </td>
                <td className="p-2">{r.idleDays}</td>
                <td className="p-2">
                  {r.allowance} of {r.target} per day
                  {r.plan && (
                    <>
                      <progress
                        aria-label={`Re-warm progress for ${r.email}`}
                        max={100}
                        value={r.plan.progressPct}
                        className="block w-32"
                      />
                      <span className="block max-w-56 text-xs text-muted-foreground">
                        Estimated: {r.plan.estimatedDaysLeft} more day
                        {r.plan.estimatedDaysLeft === 1 ? "" : "s"} - {r.plan.label}
                      </span>
                    </>
                  )}
                </td>
                <td className="p-2">
                  {r.health.score ?? "-"}
                  <Sparkline trend={r.health.trend} />
                  {r.health.cap !== null && (
                    <span className="block text-xs">Throttled to {r.health.cap}/day</span>
                  )}
                </td>
                <td className="p-2">
                  <span className="block">Sent {r.sent30d}</span>
                  <span className="block">Hard {r.hardBouncePct30d}%</span>
                  <span className="block">Soft {r.softBouncePct30d}%</span>
                  <span className="block">Replies {r.replyPct30d}%</span>
                  <span className="block">Complaints {r.complaintPct30d}%</span>
                  <span className="block max-w-48 text-xs text-muted-foreground">
                    Complaint data only when a feedback loop delivers to a connected mailbox (Gmail
                    sends none).
                  </span>
                  {r.lastBounceReasons.length > 0 && (
                    <span className="block max-w-48 text-xs">
                      Latest bounces: {r.lastBounceReasons.join("; ")}
                    </span>
                  )}
                  {r.recentErrors > 0 && (
                    <span className="block text-xs">Errors in 24 h: {r.recentErrors}</span>
                  )}
                </td>
                <td className="p-2">
                  {r.dns ? (
                    <Link
                      href="/accounts"
                      aria-label={`DNS ${r.dns.level} for ${r.dns.domain}, open the accounts page`}
                      className="rounded-full border border-border px-2 py-0.5 text-xs"
                    >
                      {r.dns.level}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="p-2">
                  {r.warmup ? (
                    <>
                      {WARMUP[r.warmup.state]}
                      <span className="block text-xs">
                        Sent in 7 days: {r.warmup.last7.reduce((n, d) => n + d.sent, 0)}
                      </span>
                    </>
                  ) : (
                    "Off"
                  )}
                </td>
                <td className="p-2">
                  <ul className="list-disc pl-4">
                    {r.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </td>
                <td className="p-2">
                  {canEdit && (r.status === "Inactive" || r.status === "Active") && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        aria-label={`Re-warm ${r.email}`}
                        onClick={() => rewarm(r)}
                      >
                        Re-warm
                      </Button>
                      {r.status === "Inactive" && (
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          aria-label={`Resume ${r.email} at full volume`}
                          onClick={() => resumeFull(r)}
                        >
                          Resume at full volume
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
