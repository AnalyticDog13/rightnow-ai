import { getEnv, runNextJob, sleep, type Clock, type JobDeps } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

const WORKERS = 2;
const IDLE_MS = 2_000;

/** D45/R13: up to 2 jobs at once (one per workspace), claiming until `maxMs` (a 2 s sleep when idle) or `signal`. */
export async function backgroundJobs(
  prisma: PrismaClient,
  clock: Clock,
  o: { maxMs?: number; signal?: AbortSignal; env?: JobDeps["env"] } = {},
) {
  const signal = o.signal ?? new AbortController().signal;
  const env = o.env ?? getEnv();
  const end = Date.now() + (o.maxMs ?? 50_000);
  let ran = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (!signal.aborted && Date.now() < end) {
        if (await runNextJob(prisma, clock, signal, { env })) ran++;
        else await sleep(Math.min(IDLE_MS, end - Date.now()), signal);
      }
    }),
  );
  return ran;
}

export const backgroundJobsJob: JobDef = {
  name: "background-jobs",
  cron: "* * * * *",
  // heartbeat (R2): a killed worker's active run is failed within ~40 s, so the stately queue is not blocked for 15 min.
  // M3: a tick runs its claimed jobs to the end (a 500-lead ai_personalize at 30 calls/min is ~17 min), as lead-import
  options: { policy: "stately", retryLimit: 0, expireInSeconds: 3 * 3600, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock, signal }) => {
    await backgroundJobs(prisma, clock, { signal });
  },
};
