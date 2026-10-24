import { optimizeVariants } from "@rightnow/core";
import type { JobDef } from "../boss";

/** D46: hourly, pauses the statistically losing A/B variants of campaigns with auto-optimize on. */
export const abOptimizeJob: JobDef = {
  name: "ab-optimize",
  cron: "17 * * * *",
  // heartbeat (R2): a killed worker's active job is failed within ~40 s, so the stately queue is not blocked for 15 min
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock }) => {
    await optimizeVariants(prisma, clock);
  },
};
