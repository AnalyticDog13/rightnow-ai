import { purgeRetention } from "@rightnow/core";
import type { JobDef } from "../boss";

/** Daily purges (Fixed names): finished webhook deliveries after 30 days (D44); later tasks add theirs. */
export const retentionJob: JobDef = {
  name: "retention",
  cron: "23 3 * * *",
  options: { policy: "stately", retryLimit: 0 },
  handler: async (_jobs, { prisma, clock }) => {
    await purgeRetention(prisma, clock);
  },
};
