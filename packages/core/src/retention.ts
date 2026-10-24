import type { PrismaClient } from "@rightnow/db/client";
import type { Clock } from "./clock";

const DAY = 86_400_000;

/**
 * The daily `retention` job (Fixed names): finished webhook deliveries are kept 30 days (D44), automation runs and
 * finished background jobs 90 days (R13), rate-limit windows 1 day (D49), AI call records 180 days (A10). Audit rows are
 * never purged: they back the A/B auto-pause state, the lead timeline, the CRM feed and removed-member labels.
 */
export async function purgeRetention(prisma: PrismaClient, clock: Clock) {
  const now = clock.now().getTime();
  const webhookDeliveries = (
    await prisma.webhookDelivery.deleteMany({
      where: {
        status: { in: ["DELIVERED", "FAILED"] },
        createdAt: { lt: new Date(now - 30 * DAY) },
      },
    })
  ).count;
  const old = new Date(now - 90 * DAY);
  const automationRuns = (
    await prisma.automationRun.deleteMany({ where: { createdAt: { lt: old } } })
  ).count;
  const backgroundJobs = (
    await prisma.backgroundJob.deleteMany({
      where: { status: { in: ["DONE", "FAILED"] }, createdAt: { lt: old } },
    })
  ).count;
  const rateLimitBuckets = (
    await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now - DAY) } } })
  ).count;
  const aiCalls = (
    await prisma.aiCall.deleteMany({ where: { createdAt: { lt: new Date(now - 180 * DAY) } } })
  ).count;
  return { webhookDeliveries, automationRuns, backgroundJobs, rateLimitBuckets, aiCalls };
}
