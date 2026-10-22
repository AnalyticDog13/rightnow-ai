import { evaluateHealth } from "@rightnow/core";
import type { JobDef } from "../boss";

/** D34: health scores, throttle / restore / pause, BounceProtect and ACCOUNTS_UNHEALTHY, every 5 minutes. */
export const deliverabilityHealthJob: JobDef = {
  name: "deliverability-health",
  cron: "*/5 * * * *",
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock }) => {
    await evaluateHealth(prisma, clock);
  },
};
