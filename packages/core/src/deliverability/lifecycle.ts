import type { EmailAccount, Prisma, PrismaClient } from "@rightnow/db/client";
import { AccountError } from "../accounts/service";
import { unwrapPrevious } from "../accounts/status";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { maxStalenessSec } from "../env";

type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;
const DAY = 86_400_000;

/** D33 / Rev 2 I6: the last campaign send, "Resume at full volume" or creation, whichever is latest. Warm-up does not count. */
export const idleSince = (a: Pick<EmailAccount, "lastSentAt" | "activityResetAt" | "createdAt">) =>
  new Date(
    Math.max(
      a.lastSentAt?.getTime() ?? 0,
      a.activityResetAt?.getTime() ?? 0,
      a.createdAt.getTime(),
    ),
  );

/**
 * D33: an ACTIVE account without a re-warm, idle for at least `inactivityDays` at `now + lookaheadSec`, becomes
 * REWARMING (AUTO, unless its domain's DNS check blocks) or INACTIVE (RECOMMEND, or AUTO with a DNS block); OFF leaves it.
 * Runs inside the caller's transaction (the caught-up sync write, or returnToService).
 */
export async function computeLifecycle(
  tx: Tx,
  clock: Clock,
  accountId: string,
  o: { lookaheadSec: number },
): Promise<"unchanged" | "INACTIVE" | "REWARMING"> {
  // locked: the decision and its audit row describe the state they change
  await tx.$queryRaw`SELECT 1 FROM "EmailAccount" WHERE id = ${accountId} FOR UPDATE`;
  const a = await tx.emailAccount.findFirst({ where: { id: accountId, deletedAt: null } });
  if (!a || a.lifecycle !== "ACTIVE" || a.rewarmStartedAt) return "unchanged";
  const w = await tx.workspace.findUniqueOrThrow({
    where: { id: a.workspaceId },
    select: { inactivityDays: true, autoRewarm: true },
  });
  const now = clock.now();
  const idleMs = now.getTime() + o.lookaheadSec * 1000 - idleSince(a).getTime();
  if (w.autoRewarm === "OFF" || idleMs < w.inactivityDays * DAY) return "unchanged";
  const dnsBlock =
    w.autoRewarm === "AUTO" &&
    (
      await tx.domainCheck.findUnique({
        where: {
          workspaceId_domain: {
            workspaceId: a.workspaceId,
            domain: a.email.split("@").pop()!.toLowerCase(),
          },
        },
        select: { level: true },
      })
    )?.level === "block";
  const to = w.autoRewarm === "AUTO" && !dnsBlock ? "REWARMING" : "INACTIVE";
  if (to === "REWARMING") await beginRewarm(tx, now, a);
  else await tx.emailAccount.update({ where: { id: a.id }, data: { lifecycle: "INACTIVE" } });
  await audit(tx, { workspaceId: a.workspaceId, at: now }, "account.inactive", a.id, {
    idleDays: Math.floor(idleMs / DAY),
    lifecycle: to,
    ...(dnsBlock && { reason: "dns_block" }),
  });
  return to;
}

/**
 * Rev 2 I2: every path back into service. Conditional on the state the caller read (lifecycle and pausedUntil), so a
 * concurrent pause or other change wins. REWARMING when a plan runs, else ACTIVE; health rates restart (I3); a
 * SOFT_BOUNCE goes, at the top (the error it covered comes back) or kept under a SYNC (M3); then the idle check.
 */
export async function returnToService(
  tx: Tx,
  clock: Clock,
  a: EmailAccount,
  o: { lookaheadSec: number },
): Promise<void> {
  const n = await tx.$executeRaw`
    UPDATE "EmailAccount" SET
      lifecycle = (CASE WHEN "rewarmStartedAt" IS NULL THEN 'ACTIVE' ELSE 'REWARMING' END)::"AccountLifecycle",
      "pausedUntil" = NULL, "healthResetAt" = ${clock.now().toISOString()}::timestamp,
      "lastError" = CASE
        WHEN "lastError"->>'kind' = 'SOFT_BOUNCE' THEN "lastError"->'previous'
        WHEN "lastError"->'previous'->>'kind' = 'SOFT_BOUNCE' THEN ${unwrapPrevious}
        ELSE "lastError" END
    WHERE id = ${a.id} AND "workspaceId" = ${a.workspaceId} AND "deletedAt" IS NULL
      AND lifecycle = ${a.lifecycle}::"AccountLifecycle"
      AND "pausedUntil" IS NOT DISTINCT FROM ${a.pausedUntil?.toISOString() ?? null}::timestamp`;
  if (n) await computeLifecycle(tx, clock, a.id, o);
}

/** D32: starts a re-warm plan (target = today's dailyLimit), keeping what completion restores. */
export async function beginRewarm(
  tx: Tx,
  now: Date,
  a: EmailAccount,
  o: { startVolume?: number; incrementPerDay?: number } = {},
): Promise<void> {
  const warmup = await tx.warmupSettings.findUnique({
    where: { accountId: a.id },
    select: { enabled: true },
  });
  await tx.emailAccount.updateMany({
    where: {
      id: a.id,
      workspaceId: a.workspaceId,
      deletedAt: null,
      lifecycle: { in: ["ACTIVE", "INACTIVE"] },
      rewarmStartedAt: null,
    },
    data: {
      lifecycle: "REWARMING",
      rewarmStartedAt: now,
      rewarmStartVolume: o.startVolume ?? 5,
      rewarmIncrementPerDay: o.incrementPerDay ?? 2,
      rewarmTarget: a.dailyLimit,
      rewarmSendDays: 0,
      rewarmLastSendDay: null,
      rewarmPrevious: { warmupEnabled: warmup?.enabled ?? false },
    },
  });
}

/** D33 "Resume at full volume": INACTIVE → ACTIVE with the idle clock reset, audited. 409 unless INACTIVE. */
export async function resumeFullVolume(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actor: Actor,
  accountId: string,
): Promise<void> {
  const now = clock.now();
  await prisma.$transaction(async (tx) => {
    const a = await tx.emailAccount.findFirst({
      where: { id: accountId, workspaceId: ws, deletedAt: null },
    });
    if (!a) throw new AccountError(404, "Not found");
    const r = await tx.emailAccount.updateMany({
      where: { id: a.id, workspaceId: ws, lifecycle: "INACTIVE" },
      data: { activityResetAt: now },
    });
    if (!r.count) throw new AccountError(409, "account is not inactive");
    await returnToService(tx, clock, a, { lookaheadSec: maxStalenessSec() });
    await audit(tx, { workspaceId: ws, actorId: actor, at: now }, "account.resume_full", a.id);
  });
}
