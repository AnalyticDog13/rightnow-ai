import type { PrismaClient } from "@rightnow/db/client";

export const HEARTBEAT_MS = 30_000;

/** Plain interval (pg-boss cron is minute-granular). Returns the stop function. */
export function startHeartbeat(
  prisma: PrismaClient,
  bootId: string,
  everyMs = HEARTBEAT_MS,
): () => void {
  const t = setInterval(() => {
    prisma.workerBoot
      .update({ where: { id: bootId }, data: { lastHeartbeatAt: new Date() } })
      .catch((e) => console.error("heartbeat failed", e));
  }, everyMs);
  return () => clearInterval(t);
}
