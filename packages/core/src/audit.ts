import type { PrismaClient } from "@rightnow/db/client";

export type AuditCtx = { workspaceId: string; actorId?: string | null; at?: Date };

/** PS-SEC-07: append an AuditLog row. `meta` must never contain secrets. */
export async function audit(
  prisma: Pick<PrismaClient, "auditLog">, // a $transaction client also fits
  ctx: AuditCtx,
  action: string,
  target?: string,
  meta?: Record<string, string | number | boolean | null | string[]>,
) {
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actorId ?? null,
      action,
      target,
      meta,
      createdAt: ctx.at,
    },
  });
}
