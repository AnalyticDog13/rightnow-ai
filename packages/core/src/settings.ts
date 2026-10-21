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
});

export async function getWorkspaceSettings(prisma: PrismaClient, ws: string) {
  const w = await prisma.workspace.findUniqueOrThrow({
    where: { id: ws },
    select: { timezone: true, physicalAddress: true },
  });
  return w;
}

/** ADMIN settings: timezone (IANA) and the CAN-SPAM physical address; the change is audited with the new values. */
export async function updateWorkspaceSettings(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actorId: string | null | undefined,
  input: unknown,
) {
  const r = patch.safeParse(input);
  if (!r.success) throw new AccountError(400, r.error.issues[0]!.message);
  const { timezone, physicalAddress } = r.data;
  return prisma.$transaction(async (tx) => {
    const w = await tx.workspace.update({
      where: { id: ws },
      data: {
        ...(timezone !== undefined && { timezone }),
        ...(physicalAddress !== undefined && { physicalAddress: physicalAddress || null }),
      },
      select: { timezone: true, physicalAddress: true },
    });
    await audit(tx, { workspaceId: ws, actorId, at: clock.now() }, "settings.update", ws, {
      ...(timezone !== undefined && { timezone }),
      ...(physicalAddress !== undefined && { physicalAddress: w.physicalAddress }),
    });
    return w;
  });
}
