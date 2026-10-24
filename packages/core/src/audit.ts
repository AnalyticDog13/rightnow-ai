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

/**
 * Display names for audit actors: the user's email, else (removed members) the email kept in their `member.remove` row,
 * else the id. Null actors are the system and get no entry.
 */
export async function actorLabels(
  prisma: Pick<PrismaClient, "auditLog" | "user">,
  ws: string,
  ids: (string | null)[],
) {
  const wanted = [...new Set(ids.filter((i): i is string => !!i))];
  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, email: true },
  });
  const labels = new Map(users.map((u) => [u.id, u.email]));
  const gone = wanted.filter((i) => !labels.has(i));
  const removed = gone.length
    ? await prisma.auditLog.findMany({
        where: {
          workspaceId: ws,
          action: "member.remove",
          OR: gone.map((id) => ({ meta: { path: ["userId"], equals: id } })),
        },
        select: { meta: true },
      })
    : [];
  const emails = new Map(
    removed.map((r) => {
      const meta = r.meta as { userId: string; email?: string | null };
      return [meta.userId, meta.email];
    }),
  );
  for (const id of gone) labels.set(id, `removed user (${emails.get(id) ?? id})`);
  return labels;
}
