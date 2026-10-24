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

/** The workspace's audit rows, newest first. `action` is a prefix (`webhook.`); paged by id cursor. */
export async function listAuditLogs(
  prisma: Pick<PrismaClient, "auditLog">,
  ws: string,
  q: { action?: string; from?: Date; to?: Date; cursor?: string; take?: number },
) {
  const take = Math.min(q.take ?? 50, 100);
  const rows = await prisma.auditLog.findMany({
    where: {
      workspaceId: ws,
      ...(q.action && { action: { startsWith: q.action } }),
      ...((q.from || q.to) && { createdAt: { gte: q.from, lte: q.to } }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor && { cursor: { id: q.cursor } }),
  });
  const next = rows.length > take ? rows.pop()! : null;
  return { logs: rows, nextCursor: next?.id ?? null };
}
