import {
  AlertCircle,
  AlertTriangle,
  Archive,
  BadgeCheck,
  Ban,
  Bot,
  CalendarCheck,
  CalendarCheck2,
  CalendarX,
  CheckCircle2,
  Clock,
  Flame,
  GitBranch,
  HelpCircle,
  Loader2,
  PauseOctagon,
  Pause,
  Pencil,
  Plane,
  PlugZap,
  ShieldAlert,
  Trophy,
  Unplug,
  Users,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "ai";
/** How a state looks: tone, an optional icon (else a dot), outline for terminal "removed" states, pulse for live sending. */
export type PillSpec = { tone: Tone; icon?: LucideIcon; outline?: boolean; pulse?: boolean };

const TONE: Record<Tone, { tint: string; fg: string; dot: string; line: string }> = {
  success: {
    tint: "bg-success-tint",
    fg: "text-success",
    dot: "bg-success-solid",
    line: "border-success-solid",
  },
  warning: {
    tint: "bg-warning-tint",
    fg: "text-warning",
    dot: "bg-warning-solid",
    line: "border-warning-solid",
  },
  danger: {
    tint: "bg-danger-tint",
    fg: "text-danger",
    dot: "bg-danger-solid",
    line: "border-danger-solid",
  },
  info: { tint: "bg-info-tint", fg: "text-info", dot: "bg-info-solid", line: "border-info-solid" },
  neutral: {
    tint: "bg-neutral-tint",
    fg: "text-neutral",
    dot: "bg-neutral-solid",
    line: "border-neutral-solid",
  },
  ai: { tint: "bg-ai-tint", fg: "text-ai", dot: "bg-ai-solid", line: "border-ai-solid" },
};

/**
 * B4.4: the word is always present; plain text to assistive tech (no role). `title` carries the reason (e.g. the
 * last error); the same reason must also be reachable without hover (drawer, note). `size="sm"` is the 20px chip.
 */
export function StatusPill({
  tone,
  icon: Icon,
  outline,
  pulse,
  title,
  size = "default",
  className,
  children,
}: PillSpec & {
  title?: string;
  size?: "default" | "sm";
  className?: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        size === "sm" ? "h-5" : "h-5.5",
        t.fg,
        outline ? cn("border", t.line) : t.tint,
        className,
      )}
    >
      {Icon ? (
        <Icon className={cn("size-3", Icon === Loader2 && "animate-spin")} aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", t.dot, pulse && "animate-pulse-dot")}
        />
      )}
      {children}
    </span>
  );
}

/** The pill spec for a label, neutral when the map does not know it. */
export const pillFor = (map: Record<string, PillSpec>, label: string): PillSpec =>
  map[label] ?? { tone: "neutral" };

/** B2.8 signal stripe for a row or card whose object is in a warning or danger state (the pill stays). */
export const stripeFor = (tone: Tone | undefined) =>
  tone === "danger" ? "stripe-danger" : tone === "warning" ? "stripe-warning" : undefined;

// ---- B4.4 mapping tables, keyed by the exact label the UI prints

/** Email account display status (STATUS_LABEL in accounts/account-status.tsx, plus Disconnected). */
export const ACCOUNT_STATUS: Record<string, PillSpec> = {
  Active: { tone: "success" },
  Paused: { tone: "neutral", icon: Pause },
  "Paused until later": { tone: "neutral", icon: Clock },
  "Re-warming": { tone: "info", icon: Flame },
  Inactive: { tone: "warning" },
  "Soft bounce error": { tone: "warning", icon: AlertTriangle },
  "Connection error": { tone: "danger", icon: PlugZap },
  "Sending error": { tone: "danger", icon: AlertCircle },
  "Needs attention": { tone: "danger", icon: AlertCircle },
  Disconnected: { tone: "danger", icon: Unplug, outline: true },
};

/** Deliverability lifecycle (AccountDeliverability["status"]). */
export const LIFECYCLE: Record<string, PillSpec> = {
  Active: { tone: "success" },
  Inactive: { tone: "warning" },
  "Re-Warming": { tone: "info", icon: Flame },
  Paused: { tone: "neutral", icon: Pause },
  "Needs Attention": { tone: "danger", icon: AlertCircle },
};

/** Warm-up state (WARMUP map); a warm-up that is not enabled shows "Off". */
export const WARMUP: Record<string, PillSpec> = {
  Active: { tone: "success", icon: Flame },
  Paused: { tone: "neutral", icon: Pause },
  Blocked: { tone: "danger", icon: Ban },
  "No peers": { tone: "warning", icon: Users },
  Suspended: { tone: "danger", icon: AlertCircle },
  Off: { tone: "neutral" },
};

/** Mailbox sync. A mailbox synced within the freshness gate shows no pill, only "Synced 3 min ago". */
export const SYNC: Record<string, PillSpec> = {
  Syncing: { tone: "info", icon: Loader2 },
  "Waiting for sync": { tone: "warning" },
  "Sync failing": { tone: "danger" },
};

/** DNS, domain level; per-record chips (SPF, DKIM, DMARC, MX) use the same tones with size="sm". */
export const DNS: Record<string, PillSpec> = {
  "DNS OK": { tone: "success" },
  "DNS warning": { tone: "warning" },
  "DNS blocks sending": { tone: "danger" },
  "DNS not checked": { tone: "neutral" },
};
export const DNS_TONE = {
  pass: "success",
  warn: "warning",
  fail: "danger",
  unknown: "neutral",
} as const;

/** Campaign display status (CampaignDisplayStatus). Active pulses only while the status endpoint says sending. */
export const CAMPAIGN_STATUS: Record<string, PillSpec> = {
  Draft: { tone: "neutral", icon: Pencil },
  Active: { tone: "success" },
  Paused: { tone: "warning", icon: Pause },
  Completed: { tone: "neutral", icon: CheckCircle2 },
  "Running Subsequences": { tone: "info", icon: GitBranch },
  "Accounts Unhealthy": { tone: "danger", icon: AlertCircle },
  "Bounce Protect": { tone: "danger", icon: ShieldAlert },
  Archived: { tone: "neutral", icon: Archive, outline: true },
};

/** Campaign lead state + stop reason. Keep any label the UI already prints; this assigns tones. */
export const LEAD_STATE: Record<string, PillSpec> = {
  Queued: { tone: "neutral" },
  "In sequence": { tone: "info" },
  Paused: { tone: "warning" },
  Completed: { tone: "neutral", icon: CheckCircle2 },
  Replied: { tone: "success" },
  "Company replied": { tone: "success" },
  "Auto-replied": { tone: "neutral" },
  Unsubscribed: { tone: "neutral", outline: true },
  Bounced: { tone: "danger" },
  Complained: { tone: "danger" },
  "Send failed": { tone: "danger" },
  "No sending account": { tone: "warning" },
  Suppressed: { tone: "neutral" },
  Skipped: { tone: "neutral" },
  "Stopped manually": { tone: "neutral" },
};

/** Lead interest (INTEREST in leads/labels.ts). No interest set: no pill. */
export const INTEREST: Record<string, PillSpec> = {
  Interested: { tone: "success" },
  "Meeting booked": { tone: "success", icon: CalendarCheck },
  "Meeting completed": { tone: "success", icon: CalendarCheck2 },
  Won: { tone: "success", icon: Trophy },
  "Out of office": { tone: "neutral", icon: Plane },
  "Not interested": { tone: "neutral" },
  "Wrong person": { tone: "neutral", icon: UserX },
  Lost: { tone: "danger" },
  "No show": { tone: "warning", icon: CalendarX },
};

/** Lead verification (VERIFICATION). */
export const VERIFICATION: Record<string, PillSpec> = {
  Verified: { tone: "success", icon: BadgeCheck },
  Pending: { tone: "info" },
  "Not verified": { tone: "neutral" },
  Invalid: { tone: "danger" },
  Risky: { tone: "warning" },
  "Catch-all": { tone: "warning" },
  "Job change": { tone: "warning" },
};

/** Suppression reason (REASON, blocklist). */
export const SUPPRESSION: Record<string, PillSpec> = {
  Unsubscribed: { tone: "neutral", outline: true },
  "Hard bounce": { tone: "danger" },
  Complaint: { tone: "danger" },
  Manual: { tone: "neutral" },
  "Not interested": { tone: "neutral" },
  "Erased (GDPR)": { tone: "neutral", outline: true },
};

/** Scheduled / message status. Held shows its reason; Outcome unknown uses OUTCOME_UNKNOWN_TIP as its title. */
export const MESSAGE_STATUS: Record<string, PillSpec> = {
  Scheduled: { tone: "info", icon: Clock },
  Sending: { tone: "info", icon: Loader2 },
  Sent: { tone: "success" },
  Held: { tone: "warning", icon: PauseOctagon },
  Failed: { tone: "danger" },
  "Outcome unknown": { tone: "warning", icon: HelpCircle },
  Cancelled: { tone: "neutral" },
};
export const OUTCOME_UNKNOWN_TIP =
  "The provider may or may not have accepted it. It will not be resent automatically.";

/** Reply category (inbox). */
export const REPLY_CATEGORY: Record<string, PillSpec> = {
  Interested: { tone: "success" },
  "Meeting requested": { tone: "success", icon: CalendarCheck },
  "Not interested": { tone: "neutral" },
  "Wrong person": { tone: "neutral" },
  Neutral: { tone: "neutral" },
  "Out of office": { tone: "neutral", icon: Plane },
  Unsubscribe: { tone: "neutral", outline: true },
  Automated: { tone: "neutral", icon: Bot },
  Uncertain: { tone: "warning", icon: HelpCircle },
};

/** CRM stage kind and task state; an overdue due date is a danger chip. */
export const STAGE_KIND: Record<string, PillSpec> = {
  Open: { tone: "neutral" },
  Won: { tone: "success", icon: Trophy },
  Lost: { tone: "danger" },
};
export const TASK_STATE: Record<string, PillSpec> = {
  Open: { tone: "neutral" },
  Done: { tone: "success" },
  "Awaiting approval": { tone: "warning" },
};

/** Automations and webhooks: rule runs, webhook state, deliveries. */
export const RUN_STATUS: Record<string, PillSpec> = {
  OK: { tone: "success" },
  Failed: { tone: "danger" },
};
export const WEBHOOK_STATUS: Record<string, PillSpec> = {
  Active: { tone: "success" },
  Error: { tone: "danger" },
};
export const DELIVERY_STATUS: Record<string, PillSpec> = {
  Pending: { tone: "neutral" },
  Sending: { tone: "info" },
  Delivered: { tone: "success" },
  Failed: { tone: "danger" },
};
