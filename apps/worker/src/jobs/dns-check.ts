import { recheckDomains, systemResolver, type Clock, type DnsResolver } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import type { JobDef } from "../boss";

/** Daily recheck of every sending domain (D35); results land in DomainCheck for the health gate and the UI. */
export const dnsCheck = (prisma: PrismaClient, clock: Clock, r: DnsResolver = systemResolver) =>
  recheckDomains(prisma, clock, r);

export const dnsCheckJob: JobDef = {
  name: "dns-check",
  cron: "0 4 * * *",
  options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  handler: async (_jobs, { prisma, clock }) => {
    await dnsCheck(prisma, clock);
  },
};
