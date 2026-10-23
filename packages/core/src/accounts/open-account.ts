import { Prisma, type AccountProvider, type CapTier } from "@rightnow/db/client";
import type { Clock } from "../clock";
import { returnToService } from "../deliverability/lifecycle";
import { maxStalenessSec } from "../env";
import { TIER_MIN_GAP } from "./caps";
import { maxDailyLimit } from "./factory";

/**
 * The one place a connect creates or revives an EmailAccount row (OAuth and SMTP/IMAP).
 * Returns the row id, or null when a live account with that email exists (the caller reports account_exists);
 * credentials are written afterwards through setCredentials.
 *
 * Revive rule (a soft-deleted row of the same email is reused, so history keeps its account):
 * - the user's earlier throttling choices survive but are clamped to the NEW tier: dailyLimit to at most half
 *   the new providerCap, minGapSec to at least the new tier's floor;
 * - provider, tier, providerCap, appendToSent and the names come from this connect;
 * - ALL provider-specific and runtime state is reset: sync cursor and state, last sync, errors, autofix, pause,
 *   health. A cursor of one provider must never be read by another.
 * - it returns to service through returnToService (Rev 2 I2), so an old mailbox comes back re-warming or inactive.
 */
export async function openAccount(
  tx: Prisma.TransactionClient,
  clock: Clock,
  workspaceId: string,
  a: {
    provider: AccountProvider;
    email: string;
    capTier: CapTier;
    providerCap: number;
    appendToSent: boolean;
    fromName: string;
    firstName: string;
    lastName: string;
  },
): Promise<string | null> {
  const where = { workspaceId, email: a.email };
  if (await tx.emailAccount.findFirst({ where: { ...where, deletedAt: null } })) return null;
  const max = maxDailyLimit(a.providerCap);
  const fresh = {
    provider: a.provider,
    capTier: a.capTier,
    providerCap: a.providerCap,
    appendToSent: a.appendToSent,
    fromName: a.fromName,
    firstName: a.firstName,
    lastName: a.lastName,
  };
  const dead = await tx.emailAccount.findFirst({
    where: { ...where, deletedAt: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!dead)
    return (
      await tx.emailAccount.create({
        data: {
          workspaceId,
          email: a.email,
          ...fresh,
          dailyLimit: Math.min(30, max),
          minGapSec: TIER_MIN_GAP[a.capTier],
        },
      })
    ).id;
  // Conditional on still being deleted: a concurrent connect that revived it first wins.
  const won = await tx.emailAccount.updateMany({
    where: { id: dead.id, workspaceId, deletedAt: { not: null } },
    data: {
      ...fresh,
      dailyLimit: Math.min(dead.dailyLimit, max),
      minGapSec: Math.max(dead.minGapSec, TIER_MIN_GAP[a.capTier]),
      deletedAt: null,
      pausedUntil: null,
      syncCursor: Prisma.DbNull,
      syncState: "IDLE",
      lastSyncCompletedAt: null,
      lastError: Prisma.DbNull,
      lastErrorAt: null,
      errorCount24h: 0,
      autofixState: "NONE",
      autofixAt: null,
      healthScore: null,
    },
  });
  if (!won.count) return null;
  const revived = await tx.emailAccount.findUniqueOrThrow({ where: { id: dead.id } });
  await returnToService(tx, clock, revived, { lookaheadSec: maxStalenessSec() });
  return dead.id;
}
