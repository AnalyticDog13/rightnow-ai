import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AccountProvider, type PrismaClient } from "@rightnow/db/client";
import type { Clock } from "./clock";
import { stopLead } from "./campaigns/hooks";
import type { EspRule } from "./campaigns/schema";
import { isSuppressed } from "./leads/suppression";
import { recordEvent } from "./mail/events";
import { priorSubject, renderForLead, renderProblem } from "./planner";
import { effectiveAllowance, type UsageRef } from "./quota";
import { routeAllowed, tagsAllowed } from "./rotation";
import { dayKey, isInWindow, nextWindowStart, startOfNextDay, type Window } from "./schedule";
import { templateVariables } from "./template";
import type { RenderEnv } from "./unsubscribe";
import { domainOf } from "./leads/domain";

type Tx = Prisma.TransactionClient;

export type ClaimOpts = {
  limit: number;
  bootId: string;
  stalenessSec: number;
  sendableProviders: AccountProvider[];
  random?: () => number;
  /** When set, the claim re-renders the row's text under its lock (the sender always passes it; see claimOne). */
  env?: RenderEnv;
};
export type Claimed = UsageRef & {
  id: string;
  campaignLeadId: string;
  stepId: string;
  claimToken: string;
  claimedAt: Date;
  rfcMessageId: string;
};

const NO_CAP = 2147483647;
const CLAIM_ERROR_PUSH_MS = 3600_000;
const MAX_CLAIM_ERRORS = 5;
const LOCK_TIMEOUT_MS = 2_000;
const BUSY_PUSH_MS = 60_000;
const ALL: AccountProvider[] = ["GMAIL", "MICROSOFT", "SMTP"];

/** Deadlock (40P01) or serialization failure (40001), however Prisma or the pg adapter surfaces it. */
export const isRetryable = (e: unknown) => {
  const x = e as { code?: string; message?: string; meta?: { code?: string } } | null;
  return x?.code === "P2034" || /40P01|40001/.test(`${x?.code} ${x?.meta?.code} ${x?.message}`);
};

export const isLockTimeout = (e: unknown) => {
  const x = e as { code?: string; message?: string; meta?: { code?: string } } | null;
  return /55P03|lock timeout/.test(`${x?.code} ${x?.meta?.code} ${x?.message}`);
};

/** Re-runs the WHOLE transaction `f` on a deadlock or serialization failure, at most `tries` times. */
export async function withTxRetry<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++)
    try {
      return await f();
    } catch (e) {
      if (i >= tries || !isRetryable(e)) throw e;
    }
}

/** D17: every provider under the Fake (which MODE=vps refuses), otherwise only those with a recorded live check. */
export async function sendableProviders(
  prisma: PrismaClient,
  env: { MAIL_PROVIDER_FAKE?: "1" },
): Promise<AccountProvider[]> {
  if (env.MAIL_PROVIDER_FAKE === "1") return [...ALL];
  const rows = await prisma.providerVerification.findMany({
    select: { provider: true },
    orderBy: { provider: "asc" },
  });
  return rows.map((r) => r.provider);
}

/**
 * D53: the Message-ID of a campaign send is fixed by (lead in campaign, step) and the sender's domain, so a send the
 * database lost (an older dump restored) is recognised from its synced Sent copy instead of going out again.
 */
export const campaignMessageId = (campaignLeadId: string, stepId: string, domain: string) =>
  `<${createHash("sha256").update(`${campaignLeadId}:${stepId}`).digest("hex").slice(0, 32)}@${domain}>`;

const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** An account the claim may send from (alias `a`): live, ACTIVE/REWARMING, sendable provider (D17), fresh (D16). Shared with pickAccount and the explainer. */
export const accountOk = (
  ts: string,
  o: Pick<ClaimOpts, "sendableProviders" | "stalenessSec">,
) => Prisma.sql`
          a."deletedAt" IS NULL AND a.lifecycle IN ('ACTIVE', 'REWARMING')
          AND a.provider = ANY(${o.sendableProviders}::text[]::"AccountProvider"[])
          AND a."lastSyncCompletedAt" >= ${ts}::timestamp - make_interval(secs => ${o.stalenessSec}::int)`;

/** stopForCompanyOnReply gate (alias `c`): every assigned live account must be fresh and not NEEDS_ATTENTION. Shared with pickAccount and the explainer. */
export const companyGateOk = (ts: string, o: Pick<ClaimOpts, "stalenessSec">) => Prisma.sql`
          (NOT c."stopForCompanyOnReply" OR NOT EXISTS (
                SELECT 1 FROM "CampaignAccount" ca2 JOIN "EmailAccount" a2 ON a2.id = ca2."accountId"
                WHERE ca2."campaignId" = c.id AND a2."deletedAt" IS NULL
                  AND (a2.lifecycle = 'NEEDS_ATTENTION' OR a2."lastSyncCompletedAt" IS NULL
                       OR a2."lastSyncCompletedAt" < ${ts}::timestamp - make_interval(secs => ${o.stalenessSec}::int))))`;

/** FROM + WHERE of a claimable row (the brief's claim SQL), shared by the SELECT and the re-check under the lock. */
const eligible = (ts: string, o: ClaimOpts) => Prisma.sql`
        FROM "ScheduledMessage" sm
        JOIN "CampaignLead" cl ON cl.id = sm."campaignLeadId"
        JOIN "SequenceStep" st ON st.id = sm."stepId"
        JOIN "Campaign" c ON c.id = sm."campaignId"
        JOIN "EmailAccount" a ON a.id = sm."accountId"
        JOIN "Workspace" w ON w.id = sm."workspaceId"
        WHERE sm.status = 'SCHEDULED' AND sm."dueAt" <= ${ts}::timestamp
          AND sm."stepId" = cl."currentStepId"
          AND (cl.state = 'ACTIVE' OR (cl.state = 'QUEUED' AND st."subsequenceId" IS NULL AND st."order" = 1))
          AND c.status = 'ACTIVE' AND c."deletedAt" IS NULL
          AND (c."startAt" IS NULL OR c."startAt" <= ${ts}::timestamp)
          AND (c."endAt" IS NULL OR c."endAt" > ${ts}::timestamp)
          AND ${accountOk(ts, o)}
          AND a."nextSendAt" <= ${ts}::timestamp AND coalesce(btrim(w."physicalAddress"), '') <> ''
          AND EXISTS (SELECT 1 FROM "CampaignAccount" ca WHERE ca."campaignId" = c.id AND ca."accountId" = a.id)
          AND ${companyGateOk(ts, o)}`;

/**
 * Claims due rows one message per transaction until `limit` are SENDING or nothing is claimable. Rows pushed back
 * (window, quota, gap race), cancelled (suppression, stale) or isolated (claim error) do not count (M2); each of those
 * moves the row out of the due set, so the loop ends.
 *
 * Lock order (D21, the global send-state order): ScheduledMessage (SKIP LOCKED) -> CampaignLead (FOR NO KEY UPDATE, the
 * I1 re-checks) -> AccountDailyUsage -> CampaignDailyUsage -> WorkspaceDailyUsage -> EmailAccount. Lead and Suppression
 * are only read (a suppressed lead's CampaignLead, already locked, is stopped). No network call happens here.
 */
export async function claimDue(db: PrismaClient, clock: Clock, o: ClaimOpts): Promise<Claimed[]> {
  const quotaHits = new Map<string, QuotaHit>();
  try {
    return await claimLoop(db, clock, o, quotaHits);
  } finally {
    // D43: QUOTA_REACHED after the claims committed, outside them; one per account and usage day (dedupe key)
    for (const q of quotaHits.values())
      await recordEvent(db, {
        workspaceId: q.workspaceId,
        type: "QUOTA_REACHED",
        occurredAt: clock.now(),
        accountId: q.accountId,
        meta: { day: q.day },
        dedupeKey: `quota:${q.accountId}:${q.day}`,
      }).catch((e) => console.error("claimDue: QUOTA_REACHED not recorded", e));
  }
}

type QuotaHit = { accountId: string; workspaceId: string; day: string };
type Picked = { id?: string; quota?: QuotaHit };

async function claimLoop(
  db: PrismaClient,
  clock: Clock,
  o: ClaimOpts,
  quotaHits: Map<string, QuotaHit>,
): Promise<Claimed[]> {
  const out: Claimed[] = [];
  while (out.length < o.limit) {
    const picked: Picked = {};
    let r: Claimed | "skip" | null;
    try {
      r = await withTxRetry(() => {
        picked.id = picked.quota = undefined;
        return claimOne(db, clock.now(), o, picked);
      });
      if (picked.quota)
        quotaHits.set(`${picked.quota.accountId}:${picked.quota.day}`, picked.quota);
    } catch (e) {
      // Rows already in `out` are committed SENDING: never lose them, whatever happens next.
      try {
        if (!picked.id || isRetryable(e)) throw e;
        // I5: a row that breaks its claim is pushed back; it never blocks the rows behind it
        if (isLockTimeout(e)) await pushBusy(db, clock.now(), picked.id);
        else await isolate(db, clock.now(), picked.id, e);
        continue;
      } catch (fatal) {
        if (!out.length) throw fatal;
        console.error("claimDue stopped early; returning the rows already claimed", fatal);
        return out;
      }
    }
    if (r === null) break;
    if (r !== "skip") out.push(r);
  }
  return out;
}

async function claimOne(
  db: PrismaClient,
  now: Date,
  o: ClaimOpts,
  picked: Picked,
): Promise<Claimed | "skip" | null> {
  const ts = now.toISOString(); // ::timestamp drops the Z: columns hold UTC wall time
  return db.$transaction(
    async (tx) => {
      // a long lock wait is contention, not a broken row: it fails fast with 55P03 and is pushed back uncounted
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      const [sel] = await tx.$queryRaw<{ id: string; campaignLeadId: string }[]>`
        SELECT sm.id, sm."campaignLeadId" ${eligible(ts, o)}
        ORDER BY sm."dueAt", sm.id
        FOR UPDATE OF sm SKIP LOCKED LIMIT 1`;
      if (!sel) return null;
      picked.id = sel.id;
      // I1: the SELECT read an unlocked snapshot of the lead; re-check it under its row lock (waits for a concurrent edit)
      await tx.$queryRaw`SELECT 1 FROM "CampaignLead" WHERE id = ${sel.campaignLeadId} FOR NO KEY UPDATE`;
      // loaded one by one: a multi-relation include issues concurrent queries on the transaction's connection
      const m = await tx.scheduledMessage.findUniqueOrThrow({ where: { id: sel.id } });
      // an edit of the variant that committed before this point is re-rendered below; a later one waits for this claim
      if (o.env && m.variantId)
        await tx.$queryRaw`SELECT 1 FROM "StepVariant" WHERE id = ${m.variantId} FOR SHARE`;
      const step = await tx.sequenceStep.findUniqueOrThrow({ where: { id: m.stepId } });
      const variant = m.variantId
        ? await tx.stepVariant.findUnique({ where: { id: m.variantId } })
        : null;
      const cl = await tx.campaignLead.findUniqueOrThrow({ where: { id: m.campaignLeadId } });
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: cl.leadId } });
      const c = await tx.campaign.findUniqueOrThrow({ where: { id: m.campaignId } });
      const schedules = await tx.campaignSchedule.findMany({ where: { campaignId: c.id } });
      const a = await tx.emailAccount.findUniqueOrThrow({ where: { id: m.accountId } });
      const w = await tx.workspace.findUniqueOrThrow({ where: { id: m.workspaceId } });
      const mine = { id: m.id, status: "SCHEDULED" as const };
      const set = (data: Prisma.ScheduledMessageUpdateManyMutationInput) =>
        tx.scheduledMessage.updateMany({ where: mine, data });

      const step1 = step.subsequenceId === null && step.order === 1;
      if (
        !(cl.state === "ACTIVE" || (cl.state === "QUEUED" && step1)) ||
        cl.currentStepId !== m.stepId ||
        step.deletedAt ||
        !variant?.active ||
        // D39 M-6: a step-1 row follows the campaign's current tags and ESP rules (the planner re-routes it);
        // follow-ups stay with the lead's first sender (D23)
        (step1 &&
          (!tagsAllowed(c, a) ||
            !routeAllowed(c.espRoutingRules as EspRule[], a.provider, lead.espType)))
      ) {
        // uncertainAt stays NULL, so the planner may re-plan the lead's current step
        await set({ status: "CANCELLED", error: "stale" });
        return "skip";
      }
      if (lead.verificationStatus === "PENDING_JOB") {
        // D38: verification in progress, the row waits (never cancelled or stopped)
        await set({ dueAt: new Date(now.getTime() + 60_000) });
        return "skip";
      }
      if (
        lead.deletedAt ||
        lead.verificationStatus === "INVALID" ||
        (await isSuppressed(tx, m.workspaceId, lead.email))
      ) {
        await set({ status: "CANCELLED", error: "suppressed" });
        await stopLead(tx, cl.id, "SUPPRESSED", now);
        return "skip";
      }
      // The SELECT's campaign/account/workspace checks came from its snapshot; a pause, stale sync or unassignment that
      // committed while we waited for the CampaignLead lock must still win. Such a row stays SCHEDULED, untouched.
      const [still] = await tx.$queryRaw<
        unknown[]
      >`SELECT 1 ${eligible(ts, o)} AND sm.id = ${m.id}`;
      if (!still) return "skip";
      const windows: Window[] = schedules.map((s) => ({
        timezone: s.timezone,
        days: s.days,
        from: s.from,
        to: s.to,
      }));
      if (!isInWindow(windows, now)) {
        await set({ dueAt: nextWindowStart(windows, now) });
        return "skip";
      }

      // Stale text (Revision 3): edit hooks skip rows a claim holds, so the claim re-renders under the row lock. The
      // List-Unsubscribe headers are not stored; the sender rebuilds them.
      let text: Prisma.ScheduledMessageUpdateManyMutationInput = {};
      if (o.env) {
        const v = variant; // null or inactive was cancelled as "stale" above
        try {
          const r = renderForLead({
            campaign: c,
            step,
            variant: v,
            lead,
            account: a,
            workspace: w,
            env: o.env,
            // only the variables this variant uses matter; any of them the lead lacks renders its fallback
            customKeys: [...templateVariables(v.subject), ...templateVariables(v.body)],
            replyTo: v.subject.trim() ? null : await priorSubject(tx, cl.id),
          });
          text = {
            renderedSubject: r.subject,
            renderedBody: r.html ?? r.text,
            renderedText: r.text,
          };
        } catch (e) {
          if (!renderProblem(e)) throw e;
          await set({ status: "CANCELLED", error: "rerender_failed" });
          return "skip";
        }
      }

      const usageDay = dayKey(a.timezone, now);
      const wsDay = dayKey(w.timezone, now);
      const units = 1 + c.cc.length + c.bcc.length;
      const random = o.random ?? Math.random;
      const gap =
        Math.max(a.minGapSec, c.minGapSec) +
        Math.floor(random() * (Math.max(a.randomGapSec, c.randomGapSec) + 1));

      await tx.$executeRaw`SAVEPOINT reserve`;
      const full = await reserve(tx, {
        ts,
        units,
        gap,
        accountId: a.id,
        campaignId: c.id,
        workspaceId: w.id,
        usageDay,
        wsDay,
        allow: [effectiveAllowance(a, now), c.dailyLimit ?? NO_CAP, w.dailyCap ?? NO_CAP],
      });
      if (full) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT reserve`;
        if (full === "account")
          picked.quota = { accountId: a.id, workspaceId: w.id, day: usageDay };
        const dueAt =
          full === "gap"
            ? (await tx.emailAccount.findUniqueOrThrow({ where: { id: a.id } })).nextSendAt
            : nextWindowStart(
                windows,
                startOfNextDay(full === "account" ? a.timezone : w.timezone, now),
              );
        await set({ dueAt });
        return "skip";
      }

      const claimToken = randomUUID();
      const rfcMessageId =
        m.rfcMessageId ?? campaignMessageId(m.campaignLeadId, m.stepId, domainOf(a.email));
      const done = await set({
        status: "SENDING",
        claimToken,
        claimedAt: now,
        claimBootId: o.bootId,
        usageDay: asDate(usageDay),
        campUsageDay: asDate(wsDay),
        wsUsageDay: asDate(wsDay),
        reservedUnits: units,
        cc: c.cc, // M8: the units were computed from exactly these
        bcc: c.bcc,
        rfcMessageId,
        ...text,
      });
      if (done.count !== 1) throw new Error("claimed row changed under its lock");
      return {
        id: m.id,
        campaignLeadId: m.campaignLeadId,
        stepId: m.stepId,
        accountId: a.id,
        campaignId: c.id,
        workspaceId: w.id,
        usageDay,
        campUsageDay: wsDay,
        wsUsageDay: wsDay,
        reservedUnits: units,
        claimToken,
        claimedAt: now,
        rfcMessageId,
      };
    },
    { timeout: 10_000 },
  );
}

/**
 * One conditional statement per table (no read-then-write), so concurrent claims serialize on the usage row and
 * re-check the latest totals. The SELECT guard refuses the first claim of a day when units exceed the allowance.
 * Returns which limit refused, or null when everything was reserved.
 */
async function reserve(
  tx: Tx,
  p: {
    ts: string;
    units: number;
    gap: number;
    accountId: string;
    campaignId: string;
    workspaceId: string;
    usageDay: string;
    wsDay: string;
    allow: [number, number, number];
  },
): Promise<"account" | "campaign" | "workspace" | "gap" | null> {
  const u = p.units;
  const [acct, camp, ws] = p.allow;
  if (
    !(
      await tx.$queryRaw<unknown[]>`
    INSERT INTO "AccountDailyUsage" ("accountId", day, sent, reserved)
    SELECT ${p.accountId}, ${p.usageDay}::date, 0, ${u}::int WHERE ${u}::int <= ${acct}::int
    ON CONFLICT ("accountId", day) DO UPDATE SET reserved = "AccountDailyUsage".reserved + ${u}::int
    WHERE "AccountDailyUsage".sent + "AccountDailyUsage".reserved + ${u}::int <= ${acct}::int
    RETURNING 1`
    ).length
  )
    return "account";
  if (
    !(
      await tx.$queryRaw<unknown[]>`
    INSERT INTO "CampaignDailyUsage" ("campaignId", day, sent, reserved)
    SELECT ${p.campaignId}, ${p.wsDay}::date, 0, ${u}::int WHERE ${u}::int <= ${camp}::int
    ON CONFLICT ("campaignId", day) DO UPDATE SET reserved = "CampaignDailyUsage".reserved + ${u}::int
    WHERE "CampaignDailyUsage".sent + "CampaignDailyUsage".reserved + ${u}::int <= ${camp}::int
    RETURNING 1`
    ).length
  )
    return "campaign";
  if (
    !(
      await tx.$queryRaw<unknown[]>`
    INSERT INTO "WorkspaceDailyUsage" ("workspaceId", day, sent, reserved)
    SELECT ${p.workspaceId}, ${p.wsDay}::date, 0, ${u}::int WHERE ${u}::int <= ${ws}::int
    ON CONFLICT ("workspaceId", day) DO UPDATE SET reserved = "WorkspaceDailyUsage".reserved + ${u}::int
    WHERE "WorkspaceDailyUsage".sent + "WorkspaceDailyUsage".reserved + ${u}::int <= ${ws}::int
    RETURNING 1`
    ).length
  )
    return "workspace";
  if (
    !(
      await tx.$queryRaw<unknown[]>`
    UPDATE "EmailAccount" SET "nextSendAt" = ${p.ts}::timestamp + make_interval(secs => ${p.gap}::int)
    WHERE id = ${p.accountId} AND "nextSendAt" <= ${p.ts}::timestamp
    RETURNING 1`
    ).length
  )
    return "gap";
  return null;
}

/** I5: a fresh transaction pushes the broken row an hour; the fifth claim error fails it and pauses the lead. */
async function isolate(db: PrismaClient, now: Date, id: string, e: unknown) {
  const error = `claim_error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
  await withTxRetry(() =>
    db.$transaction(async (tx) => {
      const mine = { id, status: "SCHEDULED" as const };
      const r = await tx.scheduledMessage.updateMany({
        where: mine,
        data: {
          dueAt: new Date(now.getTime() + CLAIM_ERROR_PUSH_MS),
          error,
          claimErrors: { increment: 1 },
        },
      });
      if (!r.count) return;
      const m = await tx.scheduledMessage.findUniqueOrThrow({ where: { id } });
      if (m.claimErrors < MAX_CLAIM_ERRORS) return;
      await tx.scheduledMessage.updateMany({ where: mine, data: { status: "FAILED" } });
      const cl = await tx.campaignLead.findUniqueOrThrow({ where: { id: m.campaignLeadId } });
      await tx.campaignLead.updateMany({
        where: { id: cl.id, state: { in: ["QUEUED", "ACTIVE"] } },
        data: { state: "PAUSED", stopReason: "SEND_FAILED" },
      });
      // M4: counted as a provider error of unknown scope (D34 health); the Event is the leaf write
      await recordEvent(tx, {
        workspaceId: m.workspaceId,
        type: "SEND_FAILED",
        occurredAt: now,
        leadId: cl.leadId,
        campaignId: m.campaignId,
        accountId: m.accountId,
        stepId: m.stepId,
        variantId: m.variantId,
        scheduledMessageId: m.id,
        meta: { error, scope: "unknown" },
        dedupeKey: `fail:${m.id}`,
      });
    }),
  );
}

/** Lock contention: retry the row a little later without counting a claim error. */
async function pushBusy(db: PrismaClient, now: Date, id: string) {
  await db.scheduledMessage.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { dueAt: new Date(now.getTime() + BUSY_PUSH_MS) },
  });
}
