import { createHash, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import type { Clock } from "../clock";

/**
 * D48 effect of a verified notification: one conditional write, and only while no request is pending, so a burst
 * collapses into one flag and one sync run. The sync job reads it; the cursor, not the notification, says what is new.
 */
async function requestSync(prisma: PrismaClient, clock: Clock, accountIds: string[]) {
  if (!accountIds.length) return 0;
  return prisma.$executeRaw`
    UPDATE "EmailAccount" SET "syncRequestedAt" = ${clock.now()}::timestamp
    WHERE id = ANY(${accountIds}::text[]) AND "deletedAt" IS NULL
      AND ("syncRequestedAt" IS NULL OR "syncRequestedAt" <= "lastSyncAttemptAt")`;
}

const gmailEnvelope = z.object({
  message: z.object({ data: z.string().max(4096) }),
});
const gmailData = z.object({
  emailAddress: z.email().max(320),
  historyId: z.union([z.string().max(64), z.number()]),
});

/** A Pub/Sub push whose JWT the route verified. Unknown mailboxes are a no-op. Returns the accounts flagged. */
export async function handleGmailPush(
  prisma: PrismaClient,
  clock: Clock,
  body: unknown,
): Promise<number> {
  const { data } = gmailEnvelope.parse(body).message;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    decoded = null; // a SyntaxError would quote the payload; the zod error below does not
  }
  const { emailAddress } = gmailData.parse(decoded);
  const accounts = await prisma.emailAccount.findMany({
    where: {
      provider: "GMAIL",
      email: { equals: emailAddress, mode: "insensitive" },
      deletedAt: null,
      pushSubscription: { externalId: { not: null } },
    },
    select: { id: true },
  });
  return requestSync(
    prisma,
    clock,
    accounts.map((a) => a.id),
  );
}

const graphBody = z.object({
  value: z
    .array(
      z.object({
        subscriptionId: z.string().min(1).max(200),
        clientState: z.string().max(512).nullish(),
        lifecycleEvent: z.string().max(64).nullish(),
      }),
    )
    .max(100),
});

const hashMatches = (clientState: string | null | undefined, hash: string | null) => {
  if (!clientState || !hash) return false;
  const a = createHash("sha256").update(clientState).digest();
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Graph change and lifecycle notifications. Each must name a known subscription (never a NULL externalId) and carry
 * its clientState; a mismatch is counted and ignored. `subscriptionRemoved` / `reauthorizationRequired` mark the
 * subscription FAILED and due (push-renew re-creates it); anything else requests a sync.
 */
export async function handleGraphPush(
  prisma: PrismaClient,
  clock: Clock,
  body: unknown,
): Promise<{ flagged: number; rejected: number }> {
  const { value } = graphBody.parse(body);
  const subs = await prisma.pushSubscription.findMany({
    where: {
      provider: "MICROSOFT",
      externalId: { in: [...new Set(value.map((v) => v.subscriptionId))] },
    },
  });
  const byId = new Map(subs.map((s) => [s.externalId!, s]));
  let rejected = 0;
  const flag = new Set<string>();
  const failed = new Map<string, { externalId: string; event: string }>();
  for (const v of value) {
    const s = byId.get(v.subscriptionId);
    if (!s) continue;
    if (!hashMatches(v.clientState, s.clientStateHash)) rejected++;
    else if (
      v.lifecycleEvent === "subscriptionRemoved" ||
      v.lifecycleEvent === "reauthorizationRequired"
    )
      failed.set(s.id, { externalId: v.subscriptionId, event: v.lifecycleEvent });
    else flag.add(s.accountId);
  }
  for (const [id, f] of failed)
    await prisma.pushSubscription.updateMany({
      where: { id, externalId: f.externalId, status: "ACTIVE" },
      data: { status: "FAILED", lastError: f.event, expiresAt: clock.now() },
    });
  return { flagged: await requestSync(prisma, clock, [...flag]), rejected };
}
