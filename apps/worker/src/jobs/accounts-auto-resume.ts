import type { Clock } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

const DAY_MS = 24 * 3600_000;

/** Ends timed pauses (a manual pause has no `pausedUntil` and stays) and purges stale OAuth sessions. */
export async function accountsAutoResume(prisma: PrismaClient, clock: Clock) {
  const now = clock.now();
  await prisma.emailAccount.updateMany({
    where: {
      lifecycle: "PAUSED",
      status: { not: "DISCONNECTED" },
      deletedAt: null,
      pausedUntil: { lte: now },
    },
    data: { lifecycle: "ACTIVE", pausedUntil: null },
  });
  await prisma.oAuthSession.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - DAY_MS) } },
  });
}

export const accountsAutoResumeJob: JobDef = {
  name: "accounts-auto-resume",
  cron: "* * * * *",
  handler: (_jobs, { prisma, clock }) => accountsAutoResume(prisma, clock),
};
