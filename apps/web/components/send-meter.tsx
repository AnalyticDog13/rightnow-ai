"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { StatusPill } from "./status-pill";

/** The fields of GET /api/v1/dashboard the meter reads. */
export type SendSummary = {
  sentToday: number;
  allowanceToday: number;
  remainingToday: number;
  workspaceCap: number | null;
  campaigns: unknown[];
};

/** B4.17 state rule: reaching the allowance is normal ("Done for today"), never a warning. */
export const sendState = (s: Pick<SendSummary, "campaigns" | "remainingToday">) =>
  s.campaigns.length === 0 ? "Idle" : s.remainingToday > 0 ? "Sending" : "Done for today";

const fill = (sent: number, max: number) =>
  max > 0 && sent >= max ? "var(--neutral-solid)" : "var(--chart-1)";
const share = (sent: number, max: number) => (max > 0 ? Math.min(100, (sent / max) * 100) : 0);

/** A 6px capacity bar: chart-1 below 100%, neutral at 100%; `cap` draws a tick at the workspace daily cap. */
export function CapacityBar({
  sent,
  max,
  cap,
  className,
}: {
  sent: number;
  max: number;
  cap?: number | null;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("relative block h-1.5 rounded-xs bg-sunken", className)}>
      <span
        className="absolute inset-y-0 left-0 rounded-xs"
        style={{ width: `${share(sent, max)}%`, background: fill(sent, max) }}
      />
      {cap != null && cap < max && (
        <span
          className="absolute -inset-y-0.5 w-px bg-fg-muted"
          style={{ left: `${share(cap, max)}%` }}
        />
      )}
    </span>
  );
}

/** The 28px compact ring (rail, mobile top bar). */
function Ring({ sent, max }: { sent: number; max: number }) {
  const r = 12.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={28} height={28} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={14} cy={14} r={r} fill="none" strokeWidth={3} stroke="var(--surface-sunken)" />
      <circle
        cx={14}
        cy={14}
        r={r}
        fill="none"
        strokeWidth={3}
        stroke={fill(sent, max)}
        strokeDasharray={`${(c * share(sent, max)) / 100} ${c}`}
      />
    </svg>
  );
}

/** Today's sent / allowance from the dashboard summary: on mount, every 60s and on "sending:changed". */
export function useSendSummary() {
  const [s, setS] = useState<SendSummary | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/v1/dashboard")
        .then((r) => (r.ok ? (r.json() as Promise<SendSummary>) : null))
        .then(setS, () => setS(null)); // a failed fetch hides the meter: no stale numbers
    void load();
    const t = setInterval(load, 60_000);
    window.addEventListener("sending:changed", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("sending:changed", load);
    };
  }, []);
  return s;
}

/**
 * B4.17 send meter. `full`: the sidebar card (links to the dashboard when elsewhere); `rail`: the ring alone;
 * `chip`: ring + "142/300" for the mobile top bar. Not live-announced: the user did not trigger the change.
 */
export function SendMeter({
  summary: s,
  variant = "full",
}: {
  summary: SendSummary | null;
  variant?: "full" | "rail" | "chip";
}) {
  const pathname = usePathname();
  if (!s) return null;
  const meter = {
    role: "meter",
    "aria-label": "Sent today",
    "aria-valuemin": 0,
    "aria-valuemax": s.allowanceToday,
    "aria-valuenow": Math.min(s.sentToday, s.allowanceToday),
    "aria-valuetext": `${s.sentToday} of ${s.allowanceToday} sends used`,
  } as const;
  if (variant !== "full")
    return (
      <span
        {...meter}
        title={`Sent today: ${s.sentToday} / ${s.allowanceToday}`}
        className="inline-flex items-center gap-1.5"
      >
        <Ring sent={s.sentToday} max={s.allowanceToday} />
        {variant === "chip" && (
          <span className="font-mono text-xs tabular-nums">
            {s.sentToday}/{s.allowanceToday}
          </span>
        )}
      </span>
    );
  const state = sendState(s);
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="micro text-fg-muted">Sent today</span>
        {state === "Sending" ? (
          <StatusPill tone="success" size="sm">
            Sending
          </StatusPill>
        ) : (
          <StatusPill tone="neutral" size="sm" icon={state === "Idle" ? undefined : CheckCircle2}>
            {state}
          </StatusPill>
        )}
      </span>
      <span {...meter} className="flex flex-col gap-1.5">
        <span className="font-mono text-sm font-medium tabular-nums">
          {s.sentToday} / {s.allowanceToday}
        </span>
        <CapacityBar sent={s.sentToday} max={s.allowanceToday} cap={s.workspaceCap} />
      </span>
    </>
  );
  const box = "flex flex-col gap-1.5 rounded-md border border-border bg-surface px-3 py-2.5";
  return pathname === "/dashboard" ? (
    <div className={box}>{body}</div>
  ) : (
    <Link href="/dashboard" className={cn(box, "transition-colors hover:bg-hover")}>
      {body}
    </Link>
  );
}
