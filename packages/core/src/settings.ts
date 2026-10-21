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
});
const SELECT = {
  timezone: true,
  physicalAddress: true,
  dailyCap: true,
  perCompanyDailyLimit: true,
  disableOpenTracking: true,
  firstEmailTextOnly: true,
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
