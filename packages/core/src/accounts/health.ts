import type { Prisma, PrismaClient } from "@rightnow/db/client";
import { AuthError, PermanentSendError } from "@rightnow/providers";
import type { Clock } from "../clock";

/** A provider error seen while using the account. Only genuine auth errors take it out of service. */
export async function recordProviderError(
  prisma: Pick<PrismaClient, "emailAccount">,
  clock: Clock,
  accountId: string,
  err: unknown,
): Promise<void> {
  const now = clock.now();
  const live = { id: accountId, deletedAt: null };
  const count = { increment: 1 };
  if (err instanceof AuthError) {
    await prisma.emailAccount.updateMany({
      where: live,
      data: {
        status: "ERROR",
        lifecycle: "NEEDS_ATTENTION",
        lastError: { kind: "CONNECTION", code: err.reason, message: err.message },
        lastErrorAt: now,
        errorCount24h: count,
      },
    });
  } else if (err instanceof PermanentSendError) {
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
      },
    });
  }
  // Rate limits, transient and ambiguous errors are the sender's retry logic, not account health.
}
