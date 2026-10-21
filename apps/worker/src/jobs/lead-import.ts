import { runImport, type Clock } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

const STALE_MS = 30 * 60_000;
const MAX_RESETS = 3;

/** Runs the oldest PENDING import. A run silent for 30 min (the MX phase keeps updatedAt moving) goes back to PENDING. */
export async function leadImport(prisma: PrismaClient, clock: Clock) {
  const stale = {
    status: "RUNNING" as const,
    updatedAt: { lt: new Date(clock.now().getTime() - STALE_MS) },
  };
  // a job that keeps killing the worker must not loop forever: fail it on the last allowed reset, keeping the error
  await prisma.importJob.updateMany({
    where: { ...stale, attempts: { gte: MAX_RESETS - 1 } },
    data: {
      status: "FAILED",
      error: "worker stopped repeatedly while running this import",
      data: null,
      finishedAt: clock.now(),
    },
  });
  await prisma.importJob.updateMany({
    where: stale,
    data: { status: "PENDING", attempts: { increment: 1 } },
  });
  const next = await prisma.importJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (next) await runImport(prisma, clock, {}, next.id);
}

export const leadImportJob: JobDef = {
  name: "lead-import",
  cron: "* * * * *",
  options: { policy: "stately", retryLimit: 0, expireInSeconds: 3 * 3600 },
  handler: (_jobs, { prisma, clock }) => leadImport(prisma, clock),
};
