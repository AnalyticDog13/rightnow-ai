import type { PipelineStage, Prisma, PrismaClient, StageKind } from "@rightnow/db/client";
import { z } from "zod";
import { AccountError, isPrismaCode, notFound } from "../accounts/service";
import { audit } from "../audit";

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;

const MAX_STAGES = 20;
const KINDS: StageKind[] = ["OPEN", "WON", "LOST"];
const DEFAULTS: [string, StageKind, number[]][] = [
  ["Not Contacted", "OPEN", []],
  ["Contacted", "OPEN", []],
  ["Replied", "OPEN", []],
  ["Interested", "OPEN", [1]],
  ["Meeting Scheduled", "OPEN", [2, 3]],
  ["Proposal Sent", "OPEN", []],
  ["Negotiation", "OPEN", []],
  ["Closed Won", "WON", [4]],
  ["Closed Lost", "LOST", [-3, -1]],
];

const fields = {
  name: z.string().trim().min(1).max(50),
  kind: z.enum(KINDS),
  interestCodes: z
    .array(z.literal([1, 2, 3, 4, 0, -1, -2, -3, -4]))
    .max(9)
    .transform((a) => [...new Set(a)]),
};
export const stageInput = z.strictObject({ ...fields, interestCodes: fields.interestCodes.default([]) });
export const stagePatch = z.strictObject({ ...fields, position: z.number().int().min(0) }).partial();

const ORDER = { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] };
// a raw statement's foreign key violation surfaces as 23503 in the message, not as P2003
const isFk = (e: unknown) =>
  isPrismaCode(e, "P2003") || /23503/.test(`${(e as { message?: string } | null)?.message}`);

/** D40 / Rev 2 M1: seeds the defaults only while the workspace has no stage, so a renamed default never comes back. */
export async function ensureStages(db: Db, ws: string): Promise<PipelineStage[]> {
  const rows = await db.pipelineStage.findMany({ where: { workspaceId: ws }, ...ORDER });
  if (rows.length) return rows;
  // two concurrent first calls: the (workspaceId, name) unique index absorbs the second
  await db.pipelineStage.createMany({
    data: DEFAULTS.map(([name, kind, interestCodes], position) => ({
      workspaceId: ws,
      name,
      kind,
      interestCodes,
      position,
    })),
    skipDuplicates: true,
  });
  return db.pipelineStage.findMany({ where: { workspaceId: ws }, ...ORDER });
}

/** Rev 2 I1: stage edits lock every stage of the workspace FOR NO KEY UPDATE, never FOR UPDATE, so a deal move's FOR KEY SHARE read never waits on them. */
async function lockStages(tx: Tx, ws: string) {
  await ensureStages(tx, ws);
  await tx.$queryRaw`SELECT id FROM "PipelineStage" WHERE "workspaceId" = ${ws} ORDER BY id FOR NO KEY UPDATE`;
  return tx.pipelineStage.findMany({ where: { workspaceId: ws }, ...ORDER });
}

/** Interest codes are unique across the workspace; at least one OPEN, WON and LOST stage remains. */
function check(
  stages: PipelineStage[],
  self: string | null,
  s?: Pick<PipelineStage, "kind" | "interestCodes">,
) {
  const others = stages.filter((x) => x.id !== self);
  if (s?.interestCodes.some((c) => others.some((o) => o.interestCodes.includes(c))))
    throw new AccountError(400, "interest_code_taken");
  const after = s ? [...others, s] : others;
  if (!KINDS.every((k) => after.some((x) => x.kind === k)))
    throw new AccountError(409, "last_stage_of_kind");
}

const renumber = (tx: Tx, ids: string[]) =>
  tx.$executeRaw`UPDATE "PipelineStage" s SET position = (v.p - 1)::int
    FROM unnest(${ids}::text[]) WITH ORDINALITY AS v(id, p) WHERE s.id = v.id AND s.position <> v.p - 1`;

export async function createStage(prisma: PrismaClient, ws: string, actor: Actor, input: unknown) {
  const d = stageInput.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const stages = await lockStages(tx, ws);
      if (stages.length >= MAX_STAGES) throw new AccountError(400, "too_many_stages");
      check(stages, null, d);
      const s = await tx.pipelineStage.create({
        data: { ...d, workspaceId: ws, position: stages.length },
      });
      await audit(tx, { workspaceId: ws, actorId: actor }, "stage.create", s.id, { kind: s.kind });
      return s;
    });
  } catch (e) {
    throw isPrismaCode(e, "P2002") ? new AccountError(409, "stage_exists") : e;
  }
}

/** Returns every stage by position (renumbered 0..n-1 when `position` moved one). */
export async function updateStage(
  prisma: PrismaClient,
  ws: string,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<PipelineStage[]> {
  const { position, ...p } = stagePatch.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const stages = await lockStages(tx, ws);
      const cur = stages.find((s) => s.id === id);
      if (!cur) throw notFound();
      check(stages, id, {
        kind: p.kind ?? cur.kind,
        interestCodes: p.interestCodes ?? cur.interestCodes,
      });
      // Rev 2 I3: a deal never changes between open and closed without a stage transition. FOR UPDATE on this one
      // stage waits for in-flight moves into it (their FOR KEY SHARE), so the count sees their deals (D21).
      if (p.kind && p.kind !== cur.kind) {
        await tx.$queryRaw`SELECT id FROM "PipelineStage" WHERE id = ${id} FOR UPDATE`;
        if (await tx.opportunity.count({ where: { stageId: id } }))
          throw new AccountError(409, "stage_not_empty");
      }
      await tx.pipelineStage.update({ where: { id }, data: p });
      if (position !== undefined) {
        const ids = stages.map((s) => s.id).filter((x) => x !== id);
        ids.splice(Math.min(position, ids.length), 0, id);
        await renumber(tx, ids);
      }
      await audit(tx, { workspaceId: ws, actorId: actor }, "stage.update", id, {
        fields: Object.keys({ ...p, ...(position !== undefined && { position }) }),
      });
      return tx.pipelineStage.findMany({ where: { workspaceId: ws }, ...ORDER });
    });
  } catch (e) {
    throw isPrismaCode(e, "P2002") ? new AccountError(409, "stage_exists") : e;
  }
}

/**
 * Rev 2 I1/I3: stages locked FOR NO KEY UPDATE, then the stage's deals FOR UPDATE and moved to `moveTo` (same kind),
 * then the DELETE. A deal that entered the stage meanwhile fails the FK: 409 stage_not_empty.
 */
export async function deleteStage(
  prisma: PrismaClient,
  ws: string,
  actor: Actor,
  id: string,
  moveTo?: string,
): Promise<{ moved: number }> {
  return prisma.$transaction(async (tx) => {
    const stages = await lockStages(tx, ws);
    const cur = stages.find((s) => s.id === id);
    const to = moveTo ? stages.find((s) => s.id === moveTo) : undefined;
    if (!cur || (moveTo && !to)) throw notFound();
    if (to && (to.kind !== cur.kind || to.id === id))
      throw new AccountError(400, "move_kind_mismatch");
    check(stages, id);
    const deals = await tx.$queryRaw<{ id: string; leadId: string }[]>`
      SELECT id, "leadId" FROM "Opportunity" WHERE "workspaceId" = ${ws} AND "stageId" = ${id} ORDER BY id FOR UPDATE`;
    if (deals.length && !to) throw new AccountError(409, "stage_not_empty");
    if (to && deals.length) {
      await tx.opportunity.updateMany({
        where: { id: { in: deals.map((d) => d.id) }, stageId: id },
        data: { stageId: to.id },
      });
      await tx.auditLog.createMany({
        data: deals.map((d) => ({
          workspaceId: ws,
          actorId: actor ?? null,
          action: "opportunity.stage",
          target: d.id,
          meta: { leadId: d.leadId, from: id, to: to.id },
        })),
      });
    }
    try {
      await tx.pipelineStage.delete({ where: { id } });
    } catch (e) {
      throw isFk(e) ? new AccountError(409, "stage_not_empty") : e;
    }
    await renumber(
      tx,
      stages.map((s) => s.id).filter((x) => x !== id),
    );
    await audit(tx, { workspaceId: ws, actorId: actor }, "stage.delete", id, {
      moveTo: to?.id ?? null,
      moved: deals.length,
    });
    return { moved: deals.length };
  });
}
