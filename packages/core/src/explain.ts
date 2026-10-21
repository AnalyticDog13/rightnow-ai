import type { AccountProvider, PrismaClient } from "@rightnow/db/client";
import { liveCampaign } from "./campaigns/service";
import type { Clock } from "./clock";
import { accountOk } from "./dispatch";
import { effectiveAllowance } from "./quota";
import { committedToday } from "./rotation";
import { dayKey, isInWindow, nextWindowStart, startOfNextDay } from "./schedule";

export type ReasonCode =
  | "draft"
  | "paused"
  | "completed"
  | "not_started"
  | "ended"
  | "outside_window"
  | "no_accounts"
  | "accounts_unavailable"
  | "sync_pending"
  | "provider_not_verified"
  | "no_physical_address"
  | "account_quota_reached"
  | "campaign_quota_reached"
  | "workspace_quota_reached"
  | "no_eligible_leads"
  | "claim_errors"
  | "held_messages"
  | "leads_suppressed"
  | "leads_paused";
export type Reason = { code: ReasonCode; message: string; accountIds?: string[]; at?: Date };
export type Why = { sending: boolean; nextWindowAt?: Date; reasons: Reason[] };

const NO_CAP = 2147483647;
// Informational: reported, but they never stop the campaign as a whole.
const INFO = new Set<ReasonCode>([
  "claim_errors",
  "held_messages",
  "leads_suppressed",
  "leads_paused",
]);
const STATUS: Record<string, [ReasonCode, string] | undefined> = {
  DRAFT: ["draft", "This campaign is a draft. Launch it to start sending."],
  PAUSED: ["paused", "This campaign is paused. Resume it to continue sending."],
  BOUNCE_PROTECT: [
    "paused",
    "Bounce protection paused this campaign because too many emails bounced.",
  ],
  ACCOUNTS_UNHEALTHY: [
    "accounts_unavailable",
    "Sending is stopped because the campaign's accounts are unhealthy.",
  ],
  COMPLETED: ["completed", "This campaign has finished."],
  ARCHIVED: ["completed", "This campaign is archived."],
};
const when = (d: Date) => d.toISOString().replace(/:\d\d\.\d+Z$/, "Z");

/**
 * Why a campaign is (not) sending, all reasons at once, from real state. Pure reads: no locks, no provider calls.
 * Account-level reasons only stop the campaign when no assigned account can send; quota reasons likewise when
 * every usable account (or the campaign / workspace) is at its limit.
 */
export async function whyNotSending(
  db: PrismaClient,
  clock: Clock,
  ws: string,
  campaignId: string,
  o: { stalenessSec: number; sendable: AccountProvider[] },
): Promise<Why> {
  const c = await liveCampaign(db, ws, campaignId);
  const now = clock.now();
  const reasons: Reason[] = [];
  const add = (code: ReasonCode, message: string, extra: Partial<Reason> = {}) =>
    reasons.push({ code, message, ...extra });

  const st = STATUS[c.status];
  if (st) return { sending: false, reasons: [{ code: st[0], message: st[1] }] };
  if (c.startAt && c.startAt > now)
    add("not_started", `This campaign starts at ${when(c.startAt)}.`, { at: c.startAt });
  if (c.endAt && c.endAt <= now)
    return {
      sending: false,
      reasons: [{ code: "ended", message: "This campaign's end date has passed." }],
    };

  const [schedules, w, assigned, openLeads, claimErr, held, suppressed, pausedLeads] =
    await Promise.all([
      db.campaignSchedule.findMany({ where: { campaignId } }),
      db.workspace.findUniqueOrThrow({ where: { id: ws } }),
      db.emailAccount.findMany({ where: { campaigns: { some: { campaignId } } } }),
      db.campaignLead.count({ where: { campaignId, state: { in: ["QUEUED", "ACTIVE"] } } }),
      db.scheduledMessage.count({
        where: { campaignId, status: "SCHEDULED", error: { startsWith: "claim_error:" } },
      }),
      db.scheduledMessage.count({ where: { campaignId, status: "HELD" } }),
      db.campaignLead.count({ where: { campaignId, state: "STOPPED", stopReason: "SUPPRESSED" } }),
      db.campaignLead.count({ where: { campaignId, state: "PAUSED" } }),
    ]);

  let nextWindowAt: Date | undefined;
  if (!isInWindow(schedules, now)) {
    nextWindowAt = schedules.length ? nextWindowStart(schedules, now) : undefined;
    add(
      "outside_window",
      nextWindowAt
        ? `Outside the sending window; the next one opens at ${when(nextWindowAt)}.`
        : "No sending window is set.",
      { at: nextWindowAt },
    );
  }
  if (!w.physicalAddress?.trim())
    add(
      "no_physical_address",
      "Add a physical mailing address in workspace settings. Every email must carry it.",
    );

  // Usable = the claim's own account predicate, evaluated by the database.
  const usableRows = assigned.length
    ? await db.$queryRaw<{ id: string }[]>`SELECT a.id FROM "EmailAccount" a
        WHERE a.id = ANY(${assigned.map((a) => a.id)}) AND ${accountOk(now.toISOString(), { sendableProviders: o.sendable, stalenessSec: o.stalenessSec })}`
    : [];
  const usable = new Set(usableRows.map((r) => r.id));
  const live = assigned.filter(
    (a) => !a.deletedAt && (a.lifecycle === "ACTIVE" || a.lifecycle === "REWARMING"),
  );
  const ids = (xs: { id: string }[]) => xs.map((a) => a.id).sort();
  const noneUsable = usable.size === 0;
  const blocking = new Set<ReasonCode>();
  const accountReason = (code: ReasonCode, message: string, xs: { id: string }[]) => {
    if (!xs.length) return;
    add(code, message, { accountIds: ids(xs) });
    if (noneUsable) blocking.add(code);
  };
  if (!assigned.length) {
    add("no_accounts", "No sending accounts are assigned to this campaign.");
    blocking.add("no_accounts");
  }
  accountReason(
    "accounts_unavailable",
    "Some accounts are deleted, paused or need attention, so they cannot send.",
    assigned.filter((a) => !live.includes(a)),
  );
  accountReason(
    "provider_not_verified",
    "These accounts' email providers have not passed the live verification check yet (see docs/ops/LIVE_VERIFICATION.md).",
    live.filter((a) => !o.sendable.includes(a.provider)),
  );
  accountReason(
    "sync_pending",
    "Waiting for inbox sync, available in a later release. Sending starts once an account's inbox has been synced.",
    live.filter((a) => o.sendable.includes(a.provider) && !usable.has(a.id)),
  );

  if (usable.size) {
    const full: typeof assigned = [];
    let reset: Date | undefined;
    for (const a of assigned.filter((x) => usable.has(x.id))) {
      const { used } = await committedToday(db, a, now);
      if (used >= effectiveAllowance(a, now)) {
        full.push(a);
        const r = startOfNextDay(a.timezone, now);
        if (!reset || r < reset) reset = r;
      }
    }
    if (full.length === usable.size) {
      add(
        "account_quota_reached",
        `Every sending account has reached its daily limit. Limits reset at ${when(reset!)}.`,
        { accountIds: ids(full), at: reset },
      );
      blocking.add("account_quota_reached");
    }
  }
  const day = new Date(`${dayKey(w.timezone, now)}T00:00:00Z`);
  const reset = startOfNextDay(w.timezone, now);
  const [cu, wu] = await Promise.all([
    db.campaignDailyUsage.findUnique({ where: { campaignId_day: { campaignId, day } } }),
    db.workspaceDailyUsage.findUnique({ where: { workspaceId_day: { workspaceId: ws, day } } }),
  ]);
  if (c.dailyLimit != null && (cu?.sent ?? 0) + (cu?.reserved ?? 0) >= (c.dailyLimit ?? NO_CAP)) {
    add(
      "campaign_quota_reached",
      `This campaign has reached its daily limit. It resets at ${when(reset)}.`,
      { at: reset },
    );
    blocking.add("campaign_quota_reached");
  }
  if (w.dailyCap != null && (wu?.sent ?? 0) + (wu?.reserved ?? 0) >= w.dailyCap) {
    add(
      "workspace_quota_reached",
      `The workspace has reached its daily sending cap. It resets at ${when(reset)}.`,
      { at: reset },
    );
    blocking.add("workspace_quota_reached");
  }

  if (!openLeads) {
    add("no_eligible_leads", "No leads are waiting to be contacted.");
    blocking.add("no_eligible_leads");
  }
  if (claimErr)
    add(
      "claim_errors",
      `${claimErr} scheduled email(s) hit an internal error while being prepared and will be retried.`,
    );
  if (held)
    add(
      "held_messages",
      `${held} email(s) are on hold awaiting your decision (the send outcome was unknown).`,
    );
  if (suppressed)
    add("leads_suppressed", `${suppressed} lead(s) were stopped because they are suppressed.`);
  if (pausedLeads) add("leads_paused", `${pausedLeads} lead(s) are paused.`);

  const stops = reasons.some(
    (r) =>
      !INFO.has(r.code) &&
      (r.code === "not_started" ||
        r.code === "outside_window" ||
        r.code === "no_physical_address" ||
        blocking.has(r.code)),
  );
  return { sending: !stops, ...(nextWindowAt && { nextWindowAt }), reasons };
}
