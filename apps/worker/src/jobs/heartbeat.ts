import type { Clock } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";

export const HEARTBEAT_MS = 30_000;

/** Plain interval (pg-boss cron is minute-granular). Returns an async stop that waits for any in-flight update. */
export function startHeartbeat(
  prisma: PrismaClient,
  bootId: string,
  clock: Clock,
  everyMs = HEARTBEAT_MS,
): () => Promise<void> {
  let inflight: Promise<unknown> = Promise.resolve();
  const t = setInterval(() => {
    inflight = prisma.workerBoot
      .update({ where: { id: bootId }, data: { lastHeartbeatAt: clock.now() } })
      .catch((e) => console.error("heartbeat failed", e));
  }, everyMs);
  return async () => {
    clearInterval(t);
    await inflight;
  };
}
