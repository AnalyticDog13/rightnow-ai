import type { EmailAccount, Prisma, PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { connectionOk, runDiagnostics } from "../accounts/diagnostics";
import { AccountError, live } from "../accounts/service";
import { audit } from "../audit";
import type { DnsFinding } from "../campaigns/launch";
import type { Clock } from "../clock";
import type { SyncDeps } from "../mail/sync";
import { rewarmAllowance } from "../quota";
import { checkWorkspaceDomains, findings, type DnsResolver } from "./dns";
import { beginRewarm } from "./lifecycle";
import { HARD_BOUNCE_SQL, perLead, TARGETED_SQL } from "./health";
import { domainOf } from "../leads/domain";

type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;
const DAY = 86_400_000;

export const rewarmInput = z.strictObject({
  startVolume: z.number().int().min(1).max(50).optional(),
  incrementPerDay: z.number().int().min(1).max(20).optional(),
  withWarmup: z.boolean().optional(),
});
export type RewarmInput = z.infer<typeof rewarmInput>;

/**
 * PS-REWARM-03/04: "Re-warm" on a live ACTIVE or INACTIVE account. Rechecks the connection (token refresh, IMAP/SMTP
 * login; an auth failure sets NEEDS_ATTENTION, M19) and the domain's DNS, fresh, both outside any transaction; a DNS
 * block refuses with the reasons. Returns the DNS warnings. `skipDns` (only the route under MAIL_PROVIDER_FAKE, as at
 * campaign launch) skips the DNS check.
 */
export async function startRewarm(
  prisma: PrismaClient,
  clock: Clock,
  deps: { providerFor: SyncDeps["providerFor"]; resolver: DnsResolver; skipDns?: boolean },
  ws: string,
  actor: Actor,
  accountId: string,
  input: RewarmInput,
): Promise<{ warnings: DnsFinding[] }> {
  const a = await live(prisma, ws, accountId);
  if (!["ACTIVE", "INACTIVE"].includes(a.lifecycle) || a.rewarmStartedAt)
    throw new AccountError(409, `cannot_rewarm_${a.lifecycle.toLowerCase()}`);
  if (!a.credentialsEnc) throw new AccountError(409, "reconnect_required");
  const d = await runDiagnostics(prisma, ws, a.id, {
    providerFor: deps.providerFor,
    clock,
    actorId: actor,
  });
  if (!connectionOk(d)) throw new AccountError(409, "reconnect_required", { checks: d.checks });
  const domain = domainOf(a.email);
  const found = !deps.skipDns
    ? (await checkWorkspaceDomains(prisma, deps.resolver, clock, ws, [domain])).flatMap(findings)
    : [];
  const issues = found.filter((f) => f.level === "block");
  if (issues.length) throw new AccountError(409, "rewarm_blocked", { issues });
  const now = clock.now();
  await prisma.$transaction(async (tx) => {
    const cur = await tx.emailAccount.findFirst({
      where: { id: a.id, workspaceId: ws, deletedAt: null },
    });
    if (!cur) throw new AccountError(404, "Not found");
    // conditional on ACTIVE/INACTIVE without a plan: a change since the checks wins
    if (!(await beginRewarm(tx, now, cur, input)))
      throw new AccountError(409, `cannot_rewarm_${cur.lifecycle.toLowerCase()}`);
    await audit(tx, { workspaceId: ws, actorId: actor, at: now }, "account.rewarm_start", a.id, {
      ...input,
      target: cur.dailyLimit,
      warnings: found.length,
    });
  });
  return { warnings: found };
}

type Previous = { warmupEnabled?: boolean; setTo?: boolean } | null;

/**
 * Ends the plan read in `a` (complete or cancel): REWARMING → ACTIVE (another lifecycle, e.g. PAUSED, stays), the
 * re-warm columns cleared, the idle clock reset (or AUTO would start a new plan at once), and warm-up restored only
 * while it still holds the value re-warm set (M12). Returns false when the plan changed meanwhile.
 */
async function endRewarm(
  tx: Tx,
  now: Date,
  a: EmailAccount,
  actor: Actor,
  action: "account.rewarm_complete" | "account.rewarm_cancel",
): Promise<boolean> {
  const complete = action === "account.rewarm_complete";
  const n = await tx.$executeRaw`
    UPDATE "EmailAccount" SET
      lifecycle = (CASE WHEN lifecycle = 'REWARMING' THEN 'ACTIVE' ELSE lifecycle::text END)::"AccountLifecycle",
      "rewarmStartedAt" = NULL, "rewarmTarget" = NULL, "rewarmSendDays" = 0, "rewarmLastSendDay" = NULL,
      "rewarmPrevious" = NULL, "activityResetAt" = ${now.toISOString()}::timestamp
    WHERE id = ${a.id} AND "workspaceId" = ${a.workspaceId} AND "deletedAt" IS NULL
      AND "rewarmStartedAt" = ${a.rewarmStartedAt!.toISOString()}::timestamp
      AND (${!complete}::boolean OR ("healthCap" IS NULL
        AND "lastErrorAt" IS NOT DISTINCT FROM ${a.lastErrorAt?.toISOString() ?? null}::timestamp))`;
  if (!n) return false;
  const prev = a.rewarmPrevious as Previous;
  if (prev?.setTo !== undefined && prev.setTo !== prev.warmupEnabled)
    await tx.warmupSettings.updateMany({
      where: { accountId: a.id, enabled: prev.setTo },
      data: { enabled: !!prev.warmupEnabled },
    });
  await audit(tx, { workspaceId: a.workspaceId, actorId: actor, at: now }, action, a.id, {
    sendDays: a.rewarmSendDays,
    target: a.rewarmTarget,
  });
  return true;
}

/** "Cancel re-warm": the same restore as completion, audited `account.rewarm_cancel`. 409 without a plan. */
export async function cancelRewarm(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actor: Actor,
  accountId: string,
): Promise<void> {
  const a = await live(prisma, ws, accountId);
  if (!a.rewarmStartedAt) throw new AccountError(409, "no_rewarm");
  const ok = await prisma.$transaction((tx) =>
    endRewarm(tx, clock.now(), a, actor, "account.rewarm_cancel"),
  );
  if (!ok) throw new AccountError(409, "no_rewarm");
}

/**
 * PS-REWARM-08, called by evaluateHealth: every plan (keyed on rewarmStartedAt, whatever the lifecycle, Rev 2 I2)
 * whose allowance reached its target, without a health cap, without hard bounces above `rewarmExitBouncePct` (default 2 %) and without an error in
 * the last `rewarmExitCleanDays` days ends: the account is ACTIVE at its normal limits. Returns how many ended.
 */
export async function completeRewarms(prisma: PrismaClient, clock: Clock): Promise<number> {
  const now = clock.now();
  const rows = await prisma.emailAccount.findMany({
    where: { rewarmStartedAt: { not: null }, healthCap: null, deletedAt: null },
    include: { workspace: { select: { rewarmExitCleanDays: true, rewarmExitBouncePct: true } } },
  });
  let done = 0;
  for (const { workspace, ...a } of rows) {
    const since = new Date(now.getTime() - workspace.rewarmExitCleanDays * DAY);
    if ((rewarmAllowance(a, now) ?? 0) < (a.rewarmTarget ?? a.dailyLimit)) continue;
    if (a.lastErrorAt && a.lastErrorAt >= since) continue;
    // D34 hard bounces (a DSN that matched no send of ours never counts), damped like the throttle
    const [c] = await prisma.$queryRaw<{ accepted: number; hard: number }[]>`
      SELECT count(*) FILTER (WHERE e.type = 'ACCEPTED')::int AS accepted,
        ${perLead(HARD_BOUNCE_SQL)} AS hard
      FROM "Event" e WHERE e."workspaceId" = ${a.workspaceId} AND e."accountId" = ${a.id}
        AND e."occurredAt" >= ${since.toISOString()}::timestamp AND ${TARGETED_SQL}`;
    if ((100 * c!.hard) / Math.max(c!.accepted, 20) > workspace.rewarmExitBouncePct) continue;
    try {
      if (await prisma.$transaction((tx) => endRewarm(tx, now, a, null, "account.rewarm_complete")))
        done++;
    } catch (e) {
      console.error(`completeRewarms: account ${a.id} skipped this run`, e);
    }
  }
  return done;
}

/** PS-REWARM-10: the plan as the dashboard shows it; null without a plan. */
export function rewarmPlanView(
  a: EmailAccount,
  now: Date,
): {
  allowance: number;
  target: number;
  progressPct: number;
  estimatedDaysLeft: number;
  label: "configurable plan, not a guaranteed reputation recovery timeline";
} | null {
  const allowance = rewarmAllowance(a, now);
  if (allowance === null) return null;
  const target = a.rewarmTarget ?? a.dailyLimit;
  return {
    allowance,
    target,
    progressPct: Math.min(100, Math.round((100 * allowance) / target)),
    estimatedDaysLeft: Math.max(0, Math.ceil((target - allowance) / a.rewarmIncrementPerDay)),
    label: "configurable plan, not a guaranteed reputation recovery timeline",
  };
}
