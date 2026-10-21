import { randomUUID } from "node:crypto";
import type { AccountProvider, Prisma, PrismaClient } from "@rightnow/db/client";
import { newMessageId } from "@rightnow/providers";
import type { Clock } from "./clock";
import { isSuppressed } from "./leads/suppression";
import { effectiveAllowance, type UsageRef } from "./quota";
import { dayKey, isInWindow, nextWindowStart, startOfNextDay, type Window } from "./schedule";

type Tx = Prisma.TransactionClient;

export type ClaimOpts = {
  limit: number;
  bootId: string;
  stalenessSec: number;
  sendableProviders: AccountProvider[];
  random?: () => number;
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
const ALL: AccountProvider[] = ["GMAIL", "MICROSOFT", "SMTP"];

/** Deadlock (40P01) or serialization failure (40001), however Prisma or the pg adapter surfaces it. */
export const isRetryable = (e: unknown) => {
  const x = e as { code?: string; message?: string; meta?: { code?: string } } | null;
  return x?.code === "P2034" || /40P01|40001/.test(`${x?.code} ${x?.meta?.code} ${x?.message}`);
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

const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/**
 * Claims due rows one message per transaction until `limit` are SENDING or nothing is claimable. Rows pushed back
 * (window, quota, gap race), cancelled (suppression, stale) or isolated (claim error) do not count (M2); each of those
 * moves the row out of the due set, so the loop ends.
 *
 * Lock order in the claim transaction: ScheduledMessage (SKIP LOCKED) -> CampaignLead (FOR NO KEY UPDATE, the I1
 * re-checks) -> Lead/Suppression (reads only, unless the lead is stopped) -> AccountDailyUsage -> CampaignDailyUsage ->
 * WorkspaceDailyUsage -> EmailAccount. No network call happens here.
 */
export async function claimDue(db: PrismaClient, clock: Clock, o: ClaimOpts): Promise<Claimed[]> {
  const out: Claimed[] = [];
  while (out.length < o.limit) {
    const picked: { id?: string } = {};
    let r: Claimed | "skip" | null;
    try {
      r = await withTxRetry(() => {
        picked.id = undefined;
        return claimOne(db, clock.now(), o, picked);
      });
    } catch (e) {
      // I5: a row that breaks its claim is pushed back and counted; it never blocks the rows behind it
      if (!picked.id || isRetryable(e)) throw e;
      await isolate(db, clock.now(), picked.id, e);
      continue;
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
  picked: { id?: string },
): Promise<Claimed | "skip" | null> {
  const ts = now.toISOString(); // ::timestamp drops the Z: columns hold UTC wall time
  return db.$transaction(
    async (tx) => {
      const [sel] = await tx.$queryRaw<{ id: string; campaignLeadId: string }[]>`
        SELECT sm.id, sm."campaignLeadId"
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
          AND a."deletedAt" IS NULL AND a.lifecycle IN ('ACTIVE', 'REWARMING')
          AND a.provider = ANY(${o.sendableProviders}::text[]::"AccountProvider"[])
          AND a."lastSyncCompletedAt" >= ${ts}::timestamp - make_interval(secs => ${o.stalenessSec}::int)
          AND a."nextSendAt" <= ${ts}::timestamp AND coalesce(btrim(w."physicalAddress"), '') <> ''
          AND EXISTS (SELECT 1 FROM "CampaignAccount" ca WHERE ca."campaignId" = c.id AND ca."accountId" = a.id)
          AND (NOT c."stopForCompanyOnReply" OR NOT EXISTS (
                SELECT 1 FROM "CampaignAccount" ca2 JOIN "EmailAccount" a2 ON a2.id = ca2."accountId"
                WHERE ca2."campaignId" = c.id AND a2."deletedAt" IS NULL
                  AND (a2.lifecycle = 'NEEDS_ATTENTION' OR a2."lastSyncCompletedAt" IS NULL
                       OR a2."lastSyncCompletedAt" < ${ts}::timestamp - make_interval(secs => ${o.stalenessSec}::int))))
        ORDER BY sm."dueAt", sm.id
        FOR UPDATE OF sm SKIP LOCKED LIMIT 1`;
      if (!sel) return null;
      picked.id = sel.id;
      // I1: the SELECT read an unlocked snapshot of the lead; re-check it under its row lock (waits for a concurrent edit)
      await tx.$queryRaw`SELECT 1 FROM "CampaignLead" WHERE id = ${sel.campaignLeadId} FOR NO KEY UPDATE`;
      const m = await tx.scheduledMessage.findUniqueOrThrow({
        where: { id: sel.id },
        include: {
          step: true,
          variant: true,
          campaignLead: { include: { lead: true } },
          campaign: { include: { schedules: true } },
          account: true,
          workspace: true,
        },
      });
      const { campaignLead: cl, campaign: c, account: a, workspace: w } = m;
      const mine = { id: m.id, status: "SCHEDULED" as const };
      const set = (data: Prisma.ScheduledMessageUpdateManyMutationInput) =>
        tx.scheduledMessage.updateMany({ where: mine, data });

      const step1 = m.step.subsequenceId === null && m.step.order === 1;
      if (
        !(cl.state === "ACTIVE" || (cl.state === "QUEUED" && step1)) ||
        cl.currentStepId !== m.stepId ||
        m.step.deletedAt ||
        !m.variant?.active
      ) {
        // uncertainAt stays NULL, so the planner may re-plan the lead's current step
        await set({ status: "CANCELLED", error: "stale" });
        return "skip";
      }
      if (
        cl.lead.deletedAt ||
        cl.lead.verificationStatus === "INVALID" ||
        (await isSuppressed(tx, m.workspaceId, cl.lead.email))
      ) {
        await set({ status: "CANCELLED", error: "suppressed" });
        await tx.campaignLead.updateMany({
          where: { id: cl.id, state: { in: ["QUEUED", "ACTIVE"] } },
          data: { state: "STOPPED", stopReason: "SUPPRESSED", nextDueAt: null, completedAt: now },
        });
        return "skip";
      }
      const windows: Window[] = c.schedules.map((s) => ({
        timezone: s.timezone,
        days: s.days,
        from: s.from,
        to: s.to,
      }));
      if (!isInWindow(windows, now)) {
        await set({ dueAt: nextWindowStart(windows, now) });
        return "skip";
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
      const rfcMessageId = m.rfcMessageId ?? newMessageId(a.email.split("@").pop()!);
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
      await tx.campaignLead.updateMany({
        where: { id: m.campaignLeadId, state: { in: ["QUEUED", "ACTIVE"] } },
        data: { state: "PAUSED", stopReason: "SEND_FAILED" },
      });
    }),
  );
}
