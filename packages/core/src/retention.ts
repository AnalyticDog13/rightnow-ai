import type { PrismaClient } from "@rightnow/db/client";
import type { Clock } from "./clock";

const DAY = 86_400_000;

/** The daily `retention` job (Fixed names): finished webhook deliveries are kept 30 days (D44). Later tasks add purges. */
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
  return { webhookDeliveries };
}
