import type { Prisma, PrismaClient } from "@rightnow/db/client";
import { AuthError, PermanentSendError } from "@rightnow/providers";
import type { Clock } from "../clock";
import { recordEvent } from "../mail/events";

/** D43: one ACCOUNT_ERROR per lifecycle change this call made (the write returned the row). */
export const accountError = (
  db: Pick<PrismaClient, "event">,
  a: { id: string; workspaceId: string },
  reason: string,
  at: Date,
) =>
  recordEvent(db, {
    workspaceId: a.workspaceId,
    type: "ACCOUNT_ERROR",
    occurredAt: at,
    accountId: a.id,
    meta: { reason },
    dedupeKey: `acct_err:${a.id}:${reason}:${at.getTime()}`,
  });

/** A provider error seen while using the account. Only genuine auth errors take it out of service. */
export async function recordProviderError(
  db: PrismaClient | Prisma.TransactionClient,
  clock: Clock,
  accountId: string,
  err: unknown,
): Promise<void> {
  // a plain client gets one transaction, so a lifecycle change and its ACCOUNT_ERROR commit together. A transaction
  // client has no $connect (Prisma removes it), while its $transaction would open a nested transaction.
  if ("$connect" in db)
    return (db as PrismaClient).$transaction((tx) => recordProviderError(tx, clock, accountId, err));
  const prisma = db;
  const now = clock.now();
  const live = { id: accountId, deletedAt: null };
  const count = { increment: 1 };
  if (err instanceof AuthError) {
    await prisma.emailAccount.updateMany({
      where: live,
      data: {
        status: "ERROR",
        lastError: { kind: "CONNECTION", code: err.reason, message: err.message },
        lastErrorAt: now,
        errorCount24h: count,
      },
    });
    // User pause wins (as in diagnostics): a paused account stays paused, and so does a reconnect of it.
    // Rev 2 R5: an account already NEEDS_ATTENTION matches nothing, so a second error writes no second Event
    const [a] = await prisma.emailAccount.updateManyAndReturn({
      where: { ...live, lifecycle: { notIn: ["PAUSED", "NEEDS_ATTENTION"] } },
      data: { lifecycle: "NEEDS_ATTENTION" },
      select: { id: true, workspaceId: true },
    });
    if (a) await accountError(prisma, a, "auth", now);
  } else if (err instanceof PermanentSendError) {
    // D18: unknown-scope rejections are strikes (3 in a row pause the mailbox; any SENT resets); account scope pauses now
    const strike = err.scope === "unknown" && err.countsTowardPause;
    await prisma.emailAccount.updateMany({
      where: live,
      data: {
        lastError: {
          kind: "SENDING",
          code: err.code,
          message: err.message,
        } satisfies Prisma.InputJsonObject,
        lastErrorAt: now,
        errorCount24h: count,
        ...(strike && { consecutivePermanentErrors: count }),
      },
    });
    if (err.scope === "account" || strike) {
      const [a] = await prisma.emailAccount.updateManyAndReturn({
        where: {
          ...live,
          lifecycle: { in: ["ACTIVE", "REWARMING"] }, // NEEDS_ATTENTION and a user pause stay as they are
          ...(err.scope === "account" ? {} : { consecutivePermanentErrors: { gte: 3 } }),
        },
        data: { lifecycle: "PAUSED", pausedUntil: null },
        select: { id: true, workspaceId: true },
      });
      if (a) await accountError(prisma, a, "send_failures", now);
    }
  }
  // Rate limits, transient and ambiguous errors are the sender's retry logic, not account health.
}
