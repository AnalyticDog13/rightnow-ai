import {
  aiClassifierFor,
  createProvider,
  getEnv,
  syncDue,
  type Clock,
  type Env,
  type SyncDeps,
} from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

/** P4-T05: syncs the due mailboxes and writes the freshness watermark the claim's gate reads (D16). */
export async function mailSync(
  prisma: PrismaClient,
  clock: Clock,
  env: Pick<Env, "SYNC_POLL_SEC" | "SYNC_MAX_STALENESS_SEC"> = getEnv(),
  providerFor: SyncDeps["providerFor"] = async (a) => createProvider(a, { prisma, clock }),
  signal?: AbortSignal,
) {
  const allowPrivate = getEnv().ALLOW_PRIVATE_HTTP_HOSTS === "1";
  // one classifier per workspace for the whole run, not per mailbox (D47)
  const classifiers = new Map<string, ReturnType<typeof aiClassifierFor>>();
  const aiClassifyFor = (ws: string) => {
    if (!classifiers.has(ws))
      classifiers.set(ws, aiClassifierFor(prisma, clock, ws, { allowPrivate }));
    return classifiers.get(ws)!;
  };
  return syncDue(prisma, clock, { providerFor, env, aiClassifyFor }, { maxMs: 50_000, signal });
}

export const mailSyncJob: JobDef = {
  name: "mail-sync",
  cron: "* * * * *",
  boot: true,
  // heartbeat: a killed worker's active job is failed within ~40 s, so the stately queue is not blocked for 15 min
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock, signal }) => {
    await mailSync(prisma, clock, undefined, undefined, signal);
  },
};
