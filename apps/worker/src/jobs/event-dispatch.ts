import { dispatchEvents, type Clock } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

/** D43: drains the Event outbox (rules, and webhooks from T02) for up to 50 s per run. */
export const eventDispatch = (
  prisma: PrismaClient,
  clock: Clock,
  o: { maxMs?: number; signal?: AbortSignal } = {},
) => dispatchEvents(prisma, clock, { maxMs: o.maxMs ?? 50_000, signal: o.signal });

export const eventDispatchJob: JobDef = {
  name: "event-dispatch",
  cron: "* * * * *",
  boot: true,
  // heartbeat (R2): a killed worker's active job is failed within ~40 s, so the stately queue is not blocked for 15 min
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock, signal }) => {
    await eventDispatch(prisma, clock, { signal });
  },
};
