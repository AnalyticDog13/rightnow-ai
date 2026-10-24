import { deliverDue, getEnv, outEnv, type Clock } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

/** D44: POSTs due webhook deliveries (outside any transaction) for up to 50 s per run. */
export const webhookDeliver = (
  prisma: PrismaClient,
  clock: Clock,
  o: { maxMs?: number; signal?: AbortSignal; resolve?: (h: string) => Promise<string[]> } = {},
) =>
  deliverDue(prisma, clock, {
    ...outEnv(getEnv()),
    resolve: o.resolve,
    maxMs: o.maxMs ?? 50_000,
    signal: o.signal,
  });

export const webhookDeliverJob: JobDef = {
  name: "webhook-deliver",
  cron: "* * * * *",
  boot: true,
  // heartbeat (R2): a killed worker's active job is failed within ~40 s, so the stately queue is not blocked for 15 min
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock, signal }) => {
    await webhookDeliver(prisma, clock, { signal });
  },
};
