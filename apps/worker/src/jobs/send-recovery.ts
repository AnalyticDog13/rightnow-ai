import {
  createProvider,
  getEnv,
  recoverExpired,
  resolveUncertain,
  type Clock,
  type Env,
  type SenderDeps,
} from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

/** P3-T11b: expired SENDING rows become UNCERTAIN, then UNCERTAIN rows are searched in Sent (never resent, D5). */
export async function sendRecovery(
  prisma: PrismaClient,
  clock: Clock,
  env: Pick<Env, "SEND_LEASE_SEC"> = getEnv(),
  providerFor: SenderDeps["providerFor"] = (a) => createProvider(a, { prisma, clock }),
) {
  const expired = await recoverExpired(prisma, clock, env.SEND_LEASE_SEC);
  return { expired, ...(await resolveUncertain(prisma, clock, { providerFor })) };
}

export const sendRecoveryJob: JobDef = {
  name: "send-recovery",
  cron: "*/5 * * * *",
  boot: true,
  // heartbeat: a killed worker's active job is failed within ~25 s, so the stately queue is not blocked for 15 min
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock }) => {
    await sendRecovery(prisma, clock);
  },
};
