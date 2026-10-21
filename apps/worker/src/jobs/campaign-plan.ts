import {
  getEnv,
  planDue,
  sendableProviders,
  unsubscribeKeys,
  type Clock,
  type Env,
} from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

type PlanEnv = Pick<
  Env,
  | "SYNC_MAX_STALENESS_SEC"
  | "APP_URL"
  | "ENCRYPTION_KEY"
  | "OLD_ENCRYPTION_KEY"
  | "MAIL_PROVIDER_FAKE"
>;

/** One planner tick (P3-T10b). The worker already validated the env at boot. */
export async function campaignPlan(prisma: PrismaClient, clock: Clock, env: PlanEnv = getEnv()) {
  return planDue(prisma, clock, {
    stalenessSec: env.SYNC_MAX_STALENESS_SEC,
    sendableProviders: await sendableProviders(prisma, env),
    env: { appUrl: env.APP_URL, unsubscribeKeys: unsubscribeKeys(env) },
  });
}

export const campaignPlanJob: JobDef = {
  name: "campaign-plan",
  cron: "* * * * *",
  boot: true,
  // heartbeat: a killed worker's active job is failed within ~40 s, so the stately queue is not blocked for 15 min
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock }) => {
    await campaignPlan(prisma, clock);
  },
};
