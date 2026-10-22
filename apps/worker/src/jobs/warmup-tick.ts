import { createProvider, warmupTick, type Clock, type SyncDeps } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

/** D36: cooperative warm-up between opted-in mailboxes of one workspace (sends, replies, placement lookups). */
export const warmup = (
  prisma: PrismaClient,
  clock: Clock,
  providerFor: SyncDeps["providerFor"] = async (a) => createProvider(a, { prisma, clock }),
  signal?: AbortSignal,
) => warmupTick(prisma, clock, { providerFor, signal });

export const warmupTickJob: JobDef = {
  name: "warmup-tick",
  cron: "*/5 * * * *",
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock, signal }) => {
    await warmup(prisma, clock, undefined, signal);
  },
};
