import { createProvider, getEnv, renewPush } from "@rightnow/core";
import type { JobDef } from "../boss";

/** D48: creates and renews the Gmail watches and Graph subscriptions (they expire in about 7 days). No-op in local mode. */
export const pushRenewJob: JobDef = {
  name: "push-renew",
  cron: "*/30 * * * *",
  boot: true,
  // heartbeat (R2): a killed worker's active job is failed within ~40 s, so the stately queue is not blocked for 15 min
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock }) => {
    await renewPush(prisma, clock, {
      env: getEnv(),
      providerFor: async (a) => createProvider(a, { prisma, clock }),
    });
  },
};
