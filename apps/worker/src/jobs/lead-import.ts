import { runImport, type Clock } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

const STALE_MS = 30 * 60_000;

/** Runs the oldest PENDING import. A run silent for 30 min (the MX phase keeps updatedAt moving) goes back to PENDING. */
export async function leadImport(prisma: PrismaClient, clock: Clock) {
  await prisma.importJob.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(clock.now().getTime() - STALE_MS) } },
    data: { status: "PENDING" },
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
