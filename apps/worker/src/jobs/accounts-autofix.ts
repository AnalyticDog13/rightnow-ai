import { AUTH_CODES, connectionOk, createProvider, type Clock } from "@rightnow/core";
import { Prisma, type EmailAccount, type PrismaClient } from "@rightnow/db/client";
import type { MailProvider } from "@rightnow/providers";
import type { JobDef } from "../boss";

const RETRY_MS = 15 * 60_000;

/** Retries accounts that failed with a non-auth connection error; auth errors need the user (reconnect). */
export async function accountsAutofix(
  prisma: PrismaClient,
  clock: Clock,
  providerFor: (a: EmailAccount) => MailProvider = (a) => createProvider(a, { prisma, clock }),
) {
  const now = clock.now();
  const due = await prisma.emailAccount.findMany({
    where: {
      status: "ERROR",
      lifecycle: { not: "NEEDS_ATTENTION" },
      deletedAt: null,
      credentialsEnc: { not: null },
      autofixState: { not: "IN_PROGRESS" },
      OR: [{ autofixAt: null }, { autofixAt: { lte: new Date(now.getTime() - RETRY_MS) } }],
    },
    take: 100,
  });
  for (const a of due) {
    const err = a.lastError as { kind?: string; code?: string } | null;
    if (err?.kind !== "CONNECTION" || AUTH_CODES.has(err.code ?? "")) continue;
    // Claim first, so two workers never run the same account.
    const claim = await prisma.emailAccount.updateMany({
      where: { id: a.id, autofixState: a.autofixState, autofixAt: a.autofixAt },
      data: { autofixState: "IN_PROGRESS", autofixAt: now },
    });
    if (!claim.count) continue;
    let ok = false;
    try {
      ok = connectionOk(await providerFor(a).diagnostics());
    } catch {
      // stays failed
    }
    await prisma.emailAccount.updateMany({
      where: { id: a.id },
      data: ok
        ? {
            status: "CONNECTED",
            lastError: Prisma.DbNull,
            lastErrorAt: null,
            autofixState: "SUCCEEDED",
          }
        : { autofixState: "FAILED" },
    });
  }
}

export const accountsAutofixJob: JobDef = {
  name: "accounts-autofix",
  cron: "*/5 * * * *",
  handler: (_jobs, { prisma, clock }) => accountsAutofix(prisma, clock),
};
