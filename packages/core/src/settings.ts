import type { PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { AccountError } from "./accounts/service";
import { audit } from "./audit";
import type { Clock } from "./clock";
import { isValidTimeZone } from "./schedule";

const patch = z.strictObject({
  timezone: z.string().refine(isValidTimeZone, "invalid_timezone").optional(),
  // empty clears it; sending stays blocked while it is empty (launch checks)
  physicalAddress: z.string().trim().max(500).optional(),
  // null = no cap
  dailyCap: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perCompanyDailyLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  disableOpenTracking: z.boolean().optional(),
  firstEmailTextOnly: z.boolean().optional(),
  // D34: account pause / BounceProtect line (hard bounce %) and the health throttle (% of the allowance kept)
  bounceThresholdPct: z.number().min(0.5).max(20).optional(),
  healthSlowdownPct: z.number().int().min(10).max(90).optional(),
  // D33 / D32: idle threshold, what happens at it, and the clean days a re-warm needs to finish
  inactivityDays: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60)]).optional(),
  autoRewarm: z.enum(["OFF", "RECOMMEND", "AUTO"]).optional(),
  rewarmExitCleanDays: z.number().int().min(1).max(30).optional(),
  // D40: one currency per workspace (ISO 4217); fixed while a deal carries money (Rev 2 M12)
  currency: z.string().regex(/^[A-Z]{3}$/, "invalid_currency").optional(),
  crmAutoOpportunity: z.boolean().optional(),
});
const SELECT = {
  timezone: true,
  physicalAddress: true,
  dailyCap: true,
  perCompanyDailyLimit: true,
  disableOpenTracking: true,
  firstEmailTextOnly: true,
  bounceThresholdPct: true,
  healthSlowdownPct: true,
  inactivityDays: true,
  autoRewarm: true,
  rewarmExitCleanDays: true,
  currency: true,
  crmAutoOpportunity: true,
} as const;

export async function getWorkspaceSettings(prisma: PrismaClient, ws: string) {
  const w = await prisma.workspace.findUniqueOrThrow({
    where: { id: ws },
    select: SELECT,
  });
  return w;
}

/** ADMIN settings: timezone (IANA), the CAN-SPAM physical address, workspace caps and the send flags; the change is audited with the new values. */
export async function updateWorkspaceSettings(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actorId: string | null | undefined,
  input: unknown,
) {
  const r = patch.safeParse(input);
  if (!r.success) throw new AccountError(400, r.error.issues[0]!.message);
  const { physicalAddress, ...rest } = r.data;
  return prisma.$transaction(async (tx) => {
    if (rest.currency) {
      // FOR UPDATE conflicts with the FK KEY SHARE of a deal insert, so the count sees in-flight deals
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${ws} FOR UPDATE`;
      const cur = await tx.workspace.findUniqueOrThrow({ where: { id: ws }, select: { currency: true } });
      const money = { workspaceId: ws, OR: [{ value: { not: 0 } }, { cashCollected: { not: 0 } }] };
      if (cur.currency !== rest.currency && (await tx.opportunity.count({ where: money })))
        throw new AccountError(409, "currency_in_use");
    }
    const w = await tx.workspace.update({
      where: { id: ws },
      data: {
        ...rest,
        ...(physicalAddress !== undefined && { physicalAddress: physicalAddress || null }),
      },
      select: SELECT,
    });
    await audit(tx, { workspaceId: ws, actorId, at: clock.now() }, "settings.update", ws, {
      ...rest,
      ...(physicalAddress !== undefined && { physicalAddress: w.physicalAddress }),
    });
    return w;
  });
}
