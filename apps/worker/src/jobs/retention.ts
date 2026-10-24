import { purgeRetention } from "@rightnow/core";
import type { JobDef } from "../boss";

/** Daily purges (Fixed names): finished webhook deliveries after 30 days (D44), automation runs and finished background jobs after 90 days (R13), rate-limit windows after 1 day (D49). */
export const retentionJob: JobDef = {
  name: "retention",
  cron: "23 3 * * *",
  options: { policy: "stately", retryLimit: 0 },
  handler: async (_jobs, { prisma, clock }) => {
    await purgeRetention(prisma, clock);
  },
};
