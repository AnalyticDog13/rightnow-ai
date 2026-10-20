import type { Clock } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db";

const HEARTBEAT_MAX_AGE_MS = 120_000;

/** PS-DEPLOY-12: db reachable and a live worker heartbeat. Body carries booleans/counts only, never error text. */
export async function readiness(prisma: PrismaClient, clock: Clock) {
  const body = {
    db: false,
    worker: false,
    // Email accounts (and so the sync gate) arrive in Phase 2.
    sync: { accountsTotal: 0, accountsFresh: 0 },
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    body.db = true;
    const live = await prisma.workerBoot.findFirst({
      where: {
        stoppedAt: null,
        lastHeartbeatAt: { gte: new Date(clock.now().getTime() - HEARTBEAT_MAX_AGE_MS) },
      },
      select: { id: true },
    });
    body.worker = live !== null;
  } catch {
    /* reported as db:false / worker:false */
  }
  return { ok: body.db && body.worker, body };
}
