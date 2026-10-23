import type { Prisma, PrismaClient, Task } from "@rightnow/db/client";
import { z } from "zod";
import { AccountError, isPrismaCode, notFound } from "../accounts/service";
import { audit } from "../audit";
import { systemClock, type Clock } from "../clock";
import { assertMembers } from "../leads/service";
import { localMidnightUtc, startOfNextDay } from "../schedule";

type Db = PrismaClient | Prisma.TransactionClient;
type Actor = string | null | undefined;

export type ApiTask = Pick<
  Task,
  | "id"
  | "title"
  | "body"
  | "dueAt"
  | "assigneeId"
  | "status"
  | "leadId"
  | "opportunityId"
  | "completedAt"
  | "createdAt"
> & { lead: { id: string; email: string } | null };

const STATUS = ["OPEN", "DONE", "AWAITING_APPROVAL"] as const;
const id = z.string().min(1).max(100);
const fields = {
  title: z.string().trim().min(1).max(200),
  body: z.string().max(10_000).nullable(),
  dueAt: z.coerce.date().nullable(),
  assigneeId: id.nullable(),
};
const createInput = z.strictObject({
  ...fields,
  body: fields.body.optional(),
  dueAt: fields.dueAt.optional(),
  assigneeId: fields.assigneeId.optional(),
  leadId: id.optional(),
  opportunityId: id.optional(),
});
const updateInput = z.strictObject({
  title: fields.title.optional(),
  body: fields.body.optional(),
  dueAt: fields.dueAt.optional(),
  assigneeId: fields.assigneeId.optional(),
  status: z.enum(STATUS).optional(),
});
const listQuery = z.strictObject({
  status: z.enum(STATUS).optional(),
  assigneeId: id.optional(),
  leadId: id.optional(),
  opportunityId: id.optional(),
  due: z.enum(["overdue", "today", "upcoming"]).optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
});

const INCLUDE = { lead: { select: { id: true, email: true } } } as const;

/**
 * `due` splits OPEN tasks by the workspace's local day: before today, within today, after today.
 * A DONE or awaiting-approval task is never due. Soonest first, undated last.
 */
export async function listTasks(db: Db, ws: string, q: unknown, now: Date): Promise<ApiTask[]> {
  const f = listQuery.parse(q);
  if (f.due && f.status && f.status !== "OPEN") return [];
  const where: Prisma.TaskWhereInput = {
    workspaceId: ws,
    OR: [{ leadId: null }, { lead: { deletedAt: null } }], // a soft-deleted lead's tasks are hidden with it
    status: f.due ? "OPEN" : (f.status ?? "OPEN"),
    ...(f.assigneeId && { assigneeId: f.assigneeId }),
    ...(f.leadId && { leadId: f.leadId }),
    ...(f.opportunityId && { opportunityId: f.opportunityId }),
  };
  if (f.due) {
    const w = await db.workspace.findUniqueOrThrow({
      where: { id: ws },
      select: { timezone: true },
    });
    const start = localMidnightUtc(
      now.toLocaleDateString("en-CA", { timeZone: w.timezone }),
      w.timezone,
    );
    const end = startOfNextDay(w.timezone, now);
    where.dueAt =
      f.due === "overdue"
        ? { lt: start }
        : f.due === "today"
          ? { gte: start, lt: end }
          : { gte: end };
  }
  return db.task.findMany({
    where,
    include: INCLUDE,
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
    take: f.take,
  });
}

const meta = (t: { leadId: string | null; opportunityId: string | null }) => ({
  ...(t.leadId && { leadId: t.leadId }),
  ...(t.opportunityId && { opportunityId: t.opportunityId }),
});

export async function createTask(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actor: Actor,
  input: unknown,
): Promise<ApiTask> {
  const d = createInput.parse(input);
  const now = clock.now();
  try {
    return await prisma.$transaction(async (tx) => {
      if (d.assigneeId) await assertMembers(tx, ws, [d.assigneeId]);
      let leadId = d.leadId ?? null;
      if (d.opportunityId) {
        const o = await tx.opportunity.findFirst({
          where: { id: d.opportunityId, workspaceId: ws, lead: { deletedAt: null } },
          select: { leadId: true },
        });
        if (!o) throw notFound();
        if (leadId && leadId !== o.leadId) throw new AccountError(400, "lead_mismatch");
        leadId = o.leadId;
      } else if (
        leadId &&
        !(await tx.lead.count({ where: { id: leadId, workspaceId: ws, deletedAt: null } }))
      )
        throw notFound();
      const t = await tx.task.create({
        data: {
          workspaceId: ws,
          title: d.title,
          body: d.body ?? null,
          dueAt: d.dueAt ?? null,
          assigneeId: d.assigneeId ?? null,
          leadId,
          opportunityId: d.opportunityId ?? null,
          createdById: actor ?? null,
          createdAt: now,
        },
        include: INCLUDE,
      });
      await audit(tx, { workspaceId: ws, actorId: actor, at: now }, "task.create", t.id, meta(t));
      return t;
    });
  } catch (e) {
    if (isPrismaCode(e, "P2003")) throw notFound(); // the lead or deal was deleted meanwhile
    throw e;
  }
}

export function updateTask(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actor: Actor,
  taskId: string,
  input: unknown,
): Promise<ApiTask> {
  const d = updateInput.parse(input);
  const now = clock.now();
  return prisma.$transaction(async (tx) => {
    // row lock: two concurrent completions both see the same old status and write one consistent state
    const [row] = await tx.$queryRaw<{ status: Task["status"] }[]>`
      SELECT "status" FROM "Task" WHERE "id" = ${taskId} AND "workspaceId" = ${ws} FOR UPDATE`;
    if (!row) throw notFound();
    if (d.assigneeId) await assertMembers(tx, ws, [d.assigneeId]);
    const { status, ...rest } = d;
    const t = await tx.task.update({
      where: { id: taskId },
      data: {
        ...rest,
        ...(status && {
          status,
          completedAt: status === "DONE" ? (row.status === "DONE" ? undefined : now) : null,
        }),
      },
      include: INCLUDE,
    });
    await audit(tx, { workspaceId: ws, actorId: actor, at: now }, "task.update", taskId, {
      ...meta(t),
      ...(status && { status }),
    });
    return t;
  });
}

export function deleteTask(
  prisma: PrismaClient,
  ws: string,
  actor: Actor,
  taskId: string,
  clock: Clock = systemClock,
) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.task.findFirst({ where: { id: taskId, workspaceId: ws } });
    if (!t || !(await tx.task.deleteMany({ where: { id: taskId, workspaceId: ws } })).count)
      throw notFound();
    await audit(
      tx,
      { workspaceId: ws, actorId: actor, at: clock.now() },
      "task.delete",
      taskId,
      meta(t),
    );
  });
}
