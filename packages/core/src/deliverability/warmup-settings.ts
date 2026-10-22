import { randomBytes } from "node:crypto";
import {
  Prisma,
  type EmailAccount,
  type PrismaClient,
  type WarmupSettings,
} from "@rightnow/db/client";
import { z } from "zod";
import { audit } from "../audit";
import type { Clock } from "../clock";

const DAY = 86_400_000;

export const WARMUP_DEFAULTS = {
  enabled: false,
  dailyLimit: 10,
  slowWarmup: true,
  startVolume: 1,
  increasePerDay: 1,
  customCurve: null,
  replyRatePct: 30,
  weekdaysOnly: false,
} as const;

export const warmupPatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  dailyLimit: z.number().int().min(1).max(50).optional(),
  slowWarmup: z.boolean().optional(),
  startVolume: z.number().int().min(1).max(50).optional(),
  increasePerDay: z.number().int().min(0).max(4).optional(),
  customCurve: z
    .array(
      z.strictObject({
        day: z.number().int().min(0).max(3650),
        volume: z.number().int().min(0).max(50),
      }),
    )
    .max(90)
    .refine((c) => c.every((e, i) => i === 0 || e.day > c[i - 1]!.day), "days must increase")
    .nullable()
    .optional(),
  replyRatePct: z.number().int().min(0).max(100).optional(),
  weekdaysOnly: z.boolean().optional(),
  filterTag: z
    .string()
    .regex(/^[A-Za-z0-9-]{3,24}$/)
    .optional(),
});
export type WarmupPatch = z.infer<typeof warmupPatchSchema>;

/** Creates the settings row on first use (filterTag `rn-` + 6 hex) or merges the patch; audits `account.warmup_update`. */
export async function updateWarmup(
  prisma: PrismaClient,
  a: EmailAccount,
  patch: WarmupPatch,
  o: { clock: Clock; actorId?: string | null },
): Promise<{ settings: WarmupSettings; warnings: string[] }> {
  const now = o.clock.now();
  const { customCurve, ...rest } = patch;
  const data = {
    ...rest,
    ...(customCurve !== undefined && { customCurve: customCurve ?? Prisma.DbNull }),
  };
  const settings = await prisma.$transaction(async (tx) => {
    const cur = await tx.warmupSettings.findUnique({ where: { accountId: a.id } });
    const row = await tx.warmupSettings.upsert({
      where: { accountId: a.id },
      create: {
        ...data,
        accountId: a.id,
        workspaceId: a.workspaceId,
        filterTag: patch.filterTag ?? `rn-${randomBytes(3).toString("hex")}`,
        startedAt: patch.enabled ? now : null,
      },
      // a re-enabled mailbox ramps again from day 0
      update: { ...data, ...(patch.enabled && !cur?.enabled && { startedAt: now }) },
    });
    await audit(
      tx,
      { workspaceId: a.workspaceId, actorId: o.actorId, at: now },
      "account.warmup_update",
      a.id,
      {
        fields: Object.keys(patch),
      },
    );
    return row;
  });
  const young = now.getTime() - a.createdAt.getTime() < 14 * DAY;
  return {
    settings,
    warnings:
      settings.enabled && !settings.slowWarmup && young ? ["slow_warmup_off_new_account"] : [],
  };
}
