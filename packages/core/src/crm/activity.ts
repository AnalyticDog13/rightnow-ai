import { Prisma, type PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { AccountError } from "../accounts/service";

type Db = PrismaClient | Prisma.TransactionClient;

export type ActivityItem = {
  id: string;
  at: Date;
  kind: "note" | "call" | "sms" | "meeting" | "reply" | "stage" | "opportunity" | "task";
  actorId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  detail: Record<string, unknown>;
};

const query = z.strictObject({
  leadId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  cursor: z.string().max(100).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});

type Row = {
  id: string;
  at: Date;
  src: "note" | "reply" | "audit";
  kind: string;
  actor: string | null;
  leadId: string | null;
  oppId: string | null;
  detail: Record<string, unknown> | null;
};

/**
 * D41, PS-CRM-01 "Inbox": the lead's notes (call, sms and meeting logs too), REPLY Events and the `opportunity.*` / `task.*`
 * audit rows, newest first, keyset on (at, id). One UNION so the page boundary is exact even when timestamps tie.
 * Audit rows are picked by `meta->>'leadId'`, so a deleted deal keeps its history.
 * shortcut: AuditLog has no meta index, add one if the feed gets slow.
 */
export async function crmActivity(
  db: Db,
  ws: string,
  q: { leadId?: string; opportunityId?: string; cursor?: string; take?: number },
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const f = query.parse(q);
  const sep = f.cursor?.indexOf("|") ?? -1;
  const cAt = new Date(f.cursor?.slice(0, sep) ?? 0);
  if (f.cursor && (sep < 1 || Number.isNaN(cAt.getTime())))
    throw new AccountError(400, "bad_cursor");
  const after = f.cursor
    ? Prisma.sql`WHERE (u."at", u."id" COLLATE "C") < (${cAt.toISOString()}::timestamp, ${f.cursor.slice(sep + 1)} COLLATE "C")`
    : Prisma.empty;

  // a deal's feed shows that deal's history plus its lead's notes and replies; a deleted deal has only its history
  let leadId = f.leadId;
  if (f.opportunityId && !leadId)
    leadId = (
      await db.opportunity.findFirst({
        where: { id: f.opportunityId, workspaceId: ws },
        select: { leadId: true },
      })
    )?.leadId;
  const noLead = f.opportunityId && !leadId; // nothing of the lead to show
  const noteLead = leadId ? Prisma.sql`AND n."leadId" = ${leadId}` : Prisma.empty;
  const replyLead = leadId ? Prisma.sql`AND e."leadId" = ${leadId}` : Prisma.empty;
  const auditScope = f.opportunityId
    ? Prisma.sql`AND ((a."action" LIKE 'opportunity.%' AND a."target" = ${f.opportunityId})
        OR (a."action" LIKE 'task.%' AND a."meta"->>'opportunityId' = ${f.opportunityId}))`
    : leadId
      ? Prisma.sql`AND a."meta"->>'leadId' = ${leadId}`
      : Prisma.empty;

  const rows = await db.$queryRaw<Row[]>`
    SELECT * FROM (
      ${
        noLead
          ? Prisma.sql`SELECT NULL::text AS id, NULL::timestamp AS "at", NULL AS src, NULL AS kind, NULL AS actor, NULL AS "leadId", NULL AS "oppId", NULL::jsonb AS detail WHERE false`
          : Prisma.sql`
      SELECT n."id", n."createdAt" AS "at", 'note' AS src, n."kind", n."authorId" AS actor, n."leadId", NULL AS "oppId",
        jsonb_build_object('body', n."body") AS detail
      FROM "Note" n WHERE n."workspaceId" = ${ws} AND n."leadId" IS NOT NULL ${noteLead}
      UNION ALL
      SELECT e."id", e."occurredAt", 'reply', 'reply', NULL, e."leadId", NULL,
        jsonb_build_object('campaignId', e."campaignId", 'category', e."meta"->'category')
      FROM "Event" e WHERE e."workspaceId" = ${ws} AND e."type" = 'REPLY' AND e."leadId" IS NOT NULL ${replyLead}
      UNION ALL`
      }
      SELECT a."id", a."createdAt", 'audit', a."action", a."actorId", a."meta"->>'leadId',
        CASE WHEN a."action" LIKE 'opportunity.%' THEN a."target" ELSE a."meta"->>'opportunityId' END,
        COALESCE(a."meta", '{}'::jsonb) || jsonb_build_object('target', a."target")
      FROM "AuditLog" a
      WHERE a."workspaceId" = ${ws} AND (a."action" LIKE 'opportunity.%' OR a."action" LIKE 'task.%') ${auditScope}
    ) u ${after}
    ORDER BY u."at" DESC, u."id" COLLATE "C" DESC
    LIMIT ${f.take + 1}`;

  const page = rows.slice(0, f.take);
  const stageIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const r of page) {
    if (r.kind === "opportunity.stage")
      for (const k of ["from", "to"]) {
        const v = r.detail?.[k];
        if (typeof v === "string") stageIds.add(v);
      }
    if (r.kind.startsWith("task.") && typeof r.detail?.target === "string")
      taskIds.add(r.detail.target);
  }
  const [stages, tasks] = await Promise.all([
    stageIds.size
      ? db.pipelineStage.findMany({
          where: { workspaceId: ws, id: { in: [...stageIds] } },
          select: { id: true, name: true },
        })
      : [],
    taskIds.size
      ? db.task.findMany({
          where: { workspaceId: ws, id: { in: [...taskIds] } },
          select: { id: true, title: true },
        })
      : [],
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const taskTitle = new Map(tasks.map((t) => [t.id, t.title]));

  const items = page.map((r): ActivityItem => {
    const base = { id: r.id, at: r.at, actorId: r.actor, leadId: r.leadId, opportunityId: r.oppId };
    const d = r.detail ?? {};
    if (r.src !== "audit") return { ...base, kind: r.kind as ActivityItem["kind"], detail: d };
    const { target, ...meta } = d;
    if (r.kind === "opportunity.stage") {
      const name = (v: unknown) => (typeof v === "string" ? (stageName.get(v) ?? null) : null);
      return { ...base, kind: "stage", detail: { from: name(meta.from), to: name(meta.to) } };
    }
    if (r.kind.startsWith("task."))
      return {
        ...base,
        kind: "task",
        detail: {
          action: r.kind,
          taskId: target,
          title: taskTitle.get(target as string) ?? null,
          status: meta.status ?? null,
        },
      };
    return { ...base, kind: "opportunity", detail: { action: r.kind, ...meta } };
  });
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > f.take && last ? `${last.at.toISOString()}|${last.id}` : null,
  };
}
