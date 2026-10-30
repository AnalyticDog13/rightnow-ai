"use client";

import type { AccountDeliverability } from "@rightnow/core";
import { Flame, Mail, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "../../../components/empty-state";
import { HealthRing } from "../../../components/health-ring";
import { CapacityBar } from "../../../components/send-meter";
import {
  DNS,
  LIFECYCLE,
  pillFor,
  StatusPill,
  WARMUP as WARMUP_PILL,
} from "../../../components/status-pill";
import { TableFrame } from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { call, errorText } from "../accounts/api-client";
import { HealthTrend } from "./health-trend";

const WARMUP: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  PROVIDER_BLOCKED: "Blocked",
  PLACEMENT_UNKNOWN: "No peers",
  SUSPENDED: "Suspended",
};
const DNS_LABEL: Record<string, string> = {
  ok: "DNS OK",
  warn: "DNS warning",
  block: "DNS blocks sending",
};
const md = "hidden md:table-cell";

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
      <Card className="p-0 md:p-0">
        <EmptyState
          icon={Mail}
          title="No email accounts yet."
          body="Connect one to see its warm-up, health and DNS here."
          actions={
            <Button asChild>
              <Link href="/accounts">Connect account</Link>
            </Button>
          }
        />
      </Card>
    );
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="text-sm empty:hidden">
        {msg}
      </p>
      <TableFrame>
        <table>
          <caption className="sr-only">Deliverability per email account</caption>
          <thead>
            <tr>
              <th scope="col" data-pin="id" className="max-md:left-0">
                Account
              </th>
              <th scope="col">Status</th>
              <th scope="col" className={md}>
                Idle days
              </th>
              <th scope="col" className={md}>
                Allowance
              </th>
              <th scope="col">Health</th>
              <th scope="col" className={md}>
                Last 30 days
              </th>
              <th scope="col" className={md}>
                DNS
              </th>
              <th scope="col" className={md}>
                Warm-up
              </th>
              <th scope="col" className={md}>
                Warnings
              </th>
              <th scope="col" className="text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bad = r.status === "Needs Attention" || r.dns?.level === "block";
              const warm = r.warmup ? (WARMUP[r.warmup.state] ?? r.warmup.state) : "Off";
              const dns = r.dns ? (DNS_LABEL[r.dns.level] ?? "DNS not checked") : "";
              return (
                <tr key={r.id} data-stripe={bad ? "danger" : undefined}>
                  <td
                    data-pin="id"
                    className="max-w-40 truncate font-medium max-md:left-0 md:max-w-56"
                    title={r.email}
                  >
                    {r.email}
                  </td>
                  <td>
                    <StatusPill {...pillFor(LIFECYCLE, r.status)}>{r.status}</StatusPill>
                  </td>
                  <td className={`${md} tabular-nums`}>{r.idleDays}</td>
                  <td className={md}>
                    <span className="whitespace-nowrap tabular-nums">
                      {r.allowance} of {r.target} per day
                    </span>
                    <CapacityBar sent={r.allowance} max={r.target} className="mt-1 w-16" />
                    {r.plan && (
                      <>
                        <progress
                          aria-label={`Re-warm progress for ${r.email}`}
                          max={100}
                          value={r.plan.progressPct}
                          className="mt-2 block w-32"
                        />
                        <span className="mt-1 block max-w-56 text-[13px]/[18px] text-fg-subtle">
                          Estimated: {r.plan.estimatedDaysLeft} more day
                          {r.plan.estimatedDaysLeft === 1 ? "" : "s"} - {r.plan.label}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    <span className="flex items-center gap-2">
                      <HealthRing score={r.health.score} size={24} />
                      <HealthTrend trend={r.health.trend} />
                    </span>
                    {r.health.cap !== null && (
                      <StatusPill tone="warning" size="sm" className="mt-1">
                        Throttled to {r.health.cap}/day
                      </StatusPill>
                    )}
                  </td>
                  <td
                    className={`${md} min-w-36 text-[13px]/[18px] whitespace-nowrap tabular-nums`}
                  >
                    <span className="block">Sent {r.sent30d}</span>
                    <span className="block">Hard {r.hardBouncePct30d}%</span>
                    <span className="block">Soft {r.softBouncePct30d}%</span>
                    <span className="block">Replies {r.replyPct30d}%</span>
                    <span className="block">Complaints {r.complaintPct30d}%</span>
                    {r.lastBounceReasons.length > 0 && (
                      <span className="mt-1 block max-w-48 whitespace-normal">
                        Latest bounces: {r.lastBounceReasons.join("; ")}
                      </span>
                    )}
                    {r.recentErrors > 0 && (
                      <span className="block">Errors in 24 h: {r.recentErrors}</span>
                    )}
                  </td>
                  <td className={md}>
                    {r.dns ? (
                      <Link
                        href={`/deliverability?domain=${encodeURIComponent(r.dns.domain)}#dns`}
                        aria-label={`DNS ${r.dns.level} for ${r.dns.domain}, show the DNS checks`}
                        className="inline-flex rounded-full hover:underline"
                      >
                        <StatusPill {...pillFor(DNS, dns)}>{dns}</StatusPill>
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">-</span>
                    )}
                  </td>
                  <td className={md}>
                    <StatusPill {...pillFor(WARMUP_PILL, warm)}>{warm}</StatusPill>
                    {r.warmup && (
                      <span className="mt-1 block text-[13px]/[18px] whitespace-nowrap text-fg-subtle tabular-nums">
                        Sent in 7 days: {r.warmup.last7.reduce((n, d) => n + d.sent, 0)}
                      </span>
                    )}
                  </td>
                  <td className={md}>
                    <ul className="flex min-w-40 flex-col items-start gap-1">
                      {r.warnings.map((w) => (
                        <li key={w}>
                          <StatusPill
                            tone="warning"
                            size="sm"
                            className="h-auto py-0.5 whitespace-normal"
                          >
                            {w}
                          </StatusPill>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="text-right">
                    {canEdit && (r.status === "Inactive" || r.status === "Active") && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Re-warm ${r.email}`}
                          onClick={() => rewarm(r)}
                        >
                          <Flame aria-hidden />
                          Re-warm
                        </Button>
                        {r.status === "Inactive" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Resume ${r.email} at full volume`}
                            onClick={() => resumeFull(r)}
                          >
                            <Play aria-hidden />
                            Resume at full volume
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      <p className="text-[13px]/[18px] text-fg-subtle">
        Complaint data only when a feedback loop delivers to a connected mailbox (Gmail sends none).
      </p>
    </div>
  );
}
