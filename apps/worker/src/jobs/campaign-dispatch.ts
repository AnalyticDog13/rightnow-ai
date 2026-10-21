import {
  createProvider,
  dispatchTick,
  getEnv,
  sendableProviders,
  unsubscribeKeys,
  type Clock,
  type Env,
  type SenderDeps,
} from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

type DispatchEnv = Pick<
  Env,
  | "SYNC_MAX_STALENESS_SEC"
  | "APP_URL"
  | "ENCRYPTION_KEY"
  | "OLD_ENCRYPTION_KEY"
  | "MAIL_PROVIDER_FAKE"
>;

/** One dispatcher tick (P3-T11a): claim, send outside any transaction, record. D17 gates the providers. */
export async function campaignDispatch(
  prisma: PrismaClient,
  clock: Clock,
  bootId: string,
  env: DispatchEnv = getEnv(),
  providerFor: SenderDeps["providerFor"] = (a) => createProvider(a, { prisma, clock }),
) {
  return dispatchTick(prisma, clock, {
    bootId,
    providerFor,
    env: { appUrl: env.APP_URL, unsubscribeKeys: unsubscribeKeys(env) },
    stalenessSec: env.SYNC_MAX_STALENESS_SEC,
    sendableProviders: await sendableProviders(prisma, env),
  });
}

export const campaignDispatchJob: JobDef = {
  name: "campaign-dispatch",
  cron: "* * * * *",
  boot: true,
  // heartbeat: a killed worker's active job is failed within ~40 s, so the stately queue is not blocked for 15 min
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock, bootId }) => {
    await campaignDispatch(prisma, clock, bootId);
  },
};
