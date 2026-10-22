import { runVerify, workspaceVerifier } from "@rightnow/core";
import type { JobDef } from "../boss";

/** D38: verifies up to 50 PENDING_JOB leads per workspace per minute (verifier HTTP/DNS never runs in a transaction). */
export const leadVerifyJob: JobDef = {
  name: "lead-verify",
  cron: "* * * * *",
  options: { retryLimit: 0 },
  handler: async (_jobs, { prisma, clock }) => {
    await runVerify(prisma, clock, { verifierFor: (ws) => workspaceVerifier(prisma, ws) });
  },
};
