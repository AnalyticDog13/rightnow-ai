import {
  Prisma,
  type EventType,
  type Opportunity,
  type PrismaClient,
  type StageKind,
} from "@rightnow/db/client";
import { z } from "zod";
import { AccountError } from "../accounts/service";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { isRetryable } from "../dispatch";
import { assertMembers } from "../leads/service";
import { recordEvent } from "../mail/events";
import { ensureStages } from "./stages";

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;

export type Attribution = {
  campaignId: string | null;
  stepId: string | null;
  variantId: string | null;
  accountId: string | null;
};
export type InterestChange = { leadId: string; from: number | null; to: number | null };
export type ApiOpportunity = {
  id: string;
  lead: { id: string; email: string; companyName: string | null };
  campaign: { id: string; name: string } | null;
  stageId: string;
  title: string;
  value: string;
  cashCollected: string;
  expectedCloseAt: Date | null;
  ownerId: string | null;
  closedAt: Date | null;
  stepId: string | null;
  variantId: string | null;
  accountId: string | null;
  createdAt: Date;
};

// Decimal(14,2) holds values below 1e12
// Decimal(14,2): compared after rounding to cents, as Postgres stores it
const MAX = 999_999_999_999.99;
const money = z.number().min(0).max(MAX);
/** D40 / Rev 2 C1: a derived value outside the column's range becomes 0, so it can never fail an insert. */
const clamp = (d: Prisma.Decimal | null | undefined) => {
  const c = d?.toDecimalPlaces(2);
  return c && c.gte(0) && c.lte(MAX) ? c : new Prisma.Decimal(0);
};
const notFound = () => new AccountError(404, "Not found");
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

const INCLUDE = { lead: { select: { id: true, email: true, companyName: true } } } as const;
type Row = Prisma.OpportunityGetPayload<{ include: typeof INCLUDE }>;

async function toApi(db: Db, ws: string, rows: Row[]): Promise<ApiOpportunity[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.campaignId ? [r.campaignId] : [])))];
  const camps = ids.length
    ? await db.campaign.findMany({
        where: { workspaceId: ws, id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const byId = new Map(camps.map((c) => [c.id, c]));
  return rows.map((r) => ({
    id: r.id,
    lead: r.lead,
    campaign: (r.campaignId && byId.get(r.campaignId)) || null,
    stageId: r.stageId,
    title: r.title,
    value: r.value.toFixed(2),
    cashCollected: r.cashCollected.toFixed(2),
    expectedCloseAt: r.expectedCloseAt,
    ownerId: r.ownerId,
    closedAt: r.closedAt,
    stepId: r.stepId,
    variantId: r.variantId,
    accountId: r.accountId,
    createdAt: r.createdAt,
  }));
}

/** The latest ACCEPTED send per lead (in `campaignId` when given): one DISTINCT ON query (Rev 2 M2). */
export async function lastSends(
  tx: Tx,
  ws: string,
  leadIds: string[],
  campaignId?: string | null,
): Promise<Map<string, Attribution>> {
  if (!leadIds.length) return new Map();
  const rows = await tx.$queryRaw<(Attribution & { leadId: string })[]>`
    SELECT DISTINCT ON ("leadId") "leadId", "campaignId", "stepId", "variantId", "accountId" FROM "Event"
    WHERE "workspaceId" = ${ws} AND type = 'ACCEPTED' AND "leadId" = ANY(${leadIds}::text[])
      ${campaignId ? Prisma.sql`AND "campaignId" = ${campaignId}` : Prisma.empty}
    ORDER BY "leadId", "occurredAt" DESC, id DESC`;
  return new Map(rows.map(({ leadId, ...a }) => [leadId, a]));
}

/** Rev 2 I1: the target stage is read FOR KEY SHARE (a concurrent stage delete waits; a deleted one reads as none). */
const keyShare = async (tx: Tx, ws: string, id: string) =>
  (
    await tx.$queryRaw<{ id: string; kind: StageKind }[]>`
      SELECT id, kind::text AS kind FROM "PipelineStage" WHERE id = ${id} AND "workspaceId" = ${ws} FOR KEY SHARE`
  )[0];

const lockDeal = async (tx: Tx, ws: string, id: string) =>
  (
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Opportunity" WHERE id = ${id} AND "workspaceId" = ${ws} FOR UPDATE`
  ).length > 0;

/** CRM Events carry the deal's attribution (Rev 2 I7). */
const crmEvent = (
  tx: Tx,
  o: Opportunity,
  type: EventType,
  at: Date,
  dedupeKey: string,
  meta: Prisma.InputJsonObject = {},
) =>
  recordEvent(tx, {
    workspaceId: o.workspaceId,
    type,
    occurredAt: at,
    leadId: o.leadId,
    campaignId: o.campaignId,
    stepId: o.stepId,
    variantId: o.variantId,
    accountId: o.accountId,
    meta: { opportunityId: o.id, ...meta },
    dedupeKey,
  });
const closeEvent = (tx: Tx, o: Opportunity, kind: StageKind, at: Date) =>
  kind === "WON"
    ? crmEvent(tx, o, "DEAL_WON", at, `won:${o.id}:${at.getTime()}`, { value: o.value.toFixed(2) })
    : crmEvent(tx, o, "DEAL_LOST", at, `lost:${o.id}:${at.getTime()}`);

/** After a deal's insert: OPPORTUNITY (+ DEAL_WON/LOST when created closed) and the audit row (ids and amounts only, Rev 2 M9). */
async function opened(tx: Tx, at: Date, actor: Actor, o: Opportunity, kind: StageKind) {
  await crmEvent(tx, o, "OPPORTUNITY", at, `opp:${o.id}`, { value: o.value.toFixed(2) });
  if (kind !== "OPEN") await closeEvent(tx, o, kind, at);
  await audit(tx, { workspaceId: o.workspaceId, actorId: actor, at }, "opportunity.create", o.id, {
    leadId: o.leadId,
    stageId: o.stageId,
    value: o.value.toFixed(2),
  });
}

/**
 * Rev 2 I2: locks the deal FOR UPDATE, reads the target stage FOR KEY SHARE, then computes from/to, so concurrent moves
 * serialize and a same-stage move is a no-op. Entering WON/LOST sets closedAt and records DEAL_WON/DEAL_LOST; back to
 * OPEN clears it. `keep` (the interest hook): "toOpen" (manual status) keeps a WON/LOST deal out of OPEN stages;
 * "closed" (reply classification) never moves a WON/LOST deal at all (D40 ruling: only a person changes a closed deal).
 */
async function moveStage(
  tx: Tx,
  clock: Clock,
  ws: string,
  actor: Actor,
  id: string,
  stageId: string,
  keep?: "toOpen" | "closed",
): Promise<"moved" | "same" | "kept" | "no_deal" | "no_stage"> {
  if (!(await lockDeal(tx, ws, id))) return "no_deal";
  const o = await tx.opportunity.findUniqueOrThrow({
    where: { id },
    include: { stage: { select: { kind: true } } },
  });
  if (o.stageId === stageId) return "same";
  const to = await keyShare(tx, ws, stageId);
  if (!to) return "no_stage";
  if (keep && o.stage.kind !== "OPEN" && (keep === "closed" || to.kind === "OPEN")) return "kept";
  const now = clock.now();
  const entering = to.kind !== "OPEN" && to.kind !== o.stage.kind;
  const moved = await tx.opportunity.update({
    where: { id },
    data: { stageId, closedAt: to.kind === "OPEN" ? null : entering ? now : o.closedAt },
  });
  await audit(tx, { workspaceId: ws, actorId: actor, at: now }, "opportunity.stage", id, {
    leadId: o.leadId,
    from: o.stageId,
    to: stageId,
  });
  if (entering) await closeEvent(tx, moved, to.kind, now);
  return "moved";
}

/**
 * D40 interest hook, in the caller's transaction after the Lead write (Rev 2 I4). Target: with `campaignId` that
 * campaign's deal, else the lead's most recently updated deal; a deal is created only when there is none, the code is
 * 1..4 and `crmAutoOpportunity` is on. A WON/LOST deal moves only to a WON/LOST stage. Code 2 records one MEETING per
 * (lead, campaign). Manual changes also record INTEREST_CHANGED. Stages and sends are loaded once per call (Rev 2 M2).
 */
export async function onInterestChange(
  tx: Tx,
  clock: Clock,
  ws: string,
  actor: Actor,
  changes: InterestChange[],
  o: { source: "reply" | "manual"; campaignId?: string | null; scheduledMessageId?: string | null },
): Promise<void> {
  const now = clock.now();
  if (o.source === "manual" && changes.length)
    await tx.event.createMany({
      data: changes.map((c) => ({
        workspaceId: ws,
        type: "INTEREST_CHANGED" as const,
        occurredAt: now,
        leadId: c.leadId,
        meta: { from: c.from, to: c.to, source: "manual" },
        dedupeKey: `interest:${c.leadId}:${now.getTime()}`,
      })),
      skipDuplicates: true,
    });
  const keep = o.source === "reply" ? "closed" : "toOpen";
  const stages = await ensureStages(tx, ws);
  const byCode = new Map(stages.flatMap((s) => s.interestCodes.map((c) => [c, s.id] as const)));
  const work = changes.filter((c) => c.to !== null && (byCode.has(c.to) || c.to === 2));
  if (!work.length) return;

  const ids = [...new Set(work.map((c) => c.leadId))];
  const campaignId = o.campaignId || null;
  const dealOf = new Map<string, Opportunity>();
  for (const d of await tx.opportunity.findMany({
    where: { workspaceId: ws, leadId: { in: ids }, ...(campaignId && { campaignId }) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  }))
    if (!dealOf.has(d.leadId)) dealOf.set(d.leadId, d);
  // Rev 2 M4: the matched send's attribution wins
  const sm = o.scheduledMessageId
    ? await tx.scheduledMessage.findFirst({
        where: { id: o.scheduledMessageId, workspaceId: ws },
        select: { campaignId: true, stepId: true, variantId: true, accountId: true },
      })
    : null;
  const sends = sm ? new Map<string, Attribution>() : await lastSends(tx, ws, ids, campaignId);
  const attOf = (leadId: string): Attribution | null => sm ?? sends.get(leadId) ?? null;
  const { crmAutoOpportunity } = await tx.workspace.findUniqueOrThrow({
    where: { id: ws },
    select: { crmAutoOpportunity: true },
  });
  const leads = new Map(
    (
      await tx.lead.findMany({
        where: { workspaceId: ws, id: { in: ids } },
        select: { id: true, email: true, companyName: true, plValue: true, ownerId: true },
      })
    ).map((l) => [l.id, l]),
  );
  const campIds = [
    ...new Set(ids.map((l) => campaignId ?? attOf(l)?.campaignId).filter((x) => !!x)),
  ] as string[];
  const camps = new Map(
    (
      await tx.campaign.findMany({
        where: { workspaceId: ws, id: { in: campIds } },
        select: { id: true, plValue: true, ownerId: true },
      })
    ).map((c) => [c.id, c]),
  );
  const stageLock = new Map<string, Awaited<ReturnType<typeof keyShare>>>();
  const lockStage = async (id: string) => {
    if (!stageLock.has(id)) stageLock.set(id, await keyShare(tx, ws, id));
    return stageLock.get(id);
  };

  for (const c of work) {
    const stageId = byCode.get(c.to!);
    let deal = dealOf.get(c.leadId) ?? null;
    if (deal && stageId) await moveStage(tx, clock, ws, actor, deal.id, stageId, keep);
    else if (!deal && stageId && c.to! >= 1 && c.to! <= 4 && crmAutoOpportunity) {
      const stage = await lockStage(stageId);
      const lead = leads.get(c.leadId);
      if (stage && lead) {
        const att = attOf(c.leadId);
        const camp = campaignId ?? att?.campaignId ?? null;
        const cp = camp ? camps.get(camp) : undefined;
        const [row] = await tx.opportunity.createManyAndReturn({
          data: [
            {
              workspaceId: ws,
              leadId: c.leadId,
              campaignId: camp,
              stageId,
              title: lead.companyName || lead.email,
              value: clamp(lead.plValue ?? cp?.plValue),
              ownerId: lead.ownerId ?? cp?.ownerId ?? actor ?? null,
              closedAt: stage.kind === "OPEN" ? null : now,
              stepId: att?.stepId ?? null,
              variantId: att?.variantId ?? null,
              accountId: att?.accountId ?? null,
            },
          ],
          skipDuplicates: true, // ON CONFLICT DO NOTHING: a concurrent create keeps its row (Rev 2 C1)
        });
        if (row) await opened(tx, now, actor, row, stage.kind);
        else {
          deal = await tx.opportunity.findFirst({
            where: { workspaceId: ws, leadId: c.leadId, campaignId: camp },
          });
          if (deal) await moveStage(tx, clock, ws, actor, deal.id, stageId, keep);
        }
        deal ??= row ?? null;
        if (deal) dealOf.set(c.leadId, deal);
      }
    }
    if (c.to === 2) {
      const a = deal ?? attOf(c.leadId);
      await recordEvent(tx, {
        workspaceId: ws,
        type: "MEETING",
        occurredAt: now,
        leadId: c.leadId,
        campaignId: a?.campaignId ?? null,
        stepId: a?.stepId ?? null,
        variantId: a?.variantId ?? null,
        accountId: a?.accountId ?? null,
        meta: deal ? { opportunityId: deal.id } : {},
        dedupeKey: `meeting:${c.leadId}:${a?.campaignId ?? "none"}`,
      });
    }
  }
}

/**
 * Rev 2 C1: runs `fn` under SAVEPOINT `name`. A retryable error (P2034, 40P01, 40001) is re-thrown so `withTxRetry`
 * reruns the whole transaction; any other error rolls back to the savepoint and is passed to `onError` as a code.
 */
export async function inSavepoint(
  tx: Tx,
  name: string,
  fn: () => Promise<void>,
  onError: (code: string) => Promise<void>,
): Promise<void> {
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    await fn();
  } catch (e) {
    if (isRetryable(e)) throw e;
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    const x = e as { code?: unknown; meta?: { code?: unknown } } | null;
    const code = x?.meta?.code ?? x?.code;
    return onError(typeof code === "string" ? code : e instanceof Error ? e.name : "unknown");
  }
  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
}

const id = z.string().min(1);
const fields = {
  stageId: id,
  title: z.string().trim().min(1).max(200),
  value: money,
  cashCollected: money,
  expectedCloseAt: z.coerce.date().nullable(),
  ownerId: id.max(100).nullable(),
};
const createInput = z
  .strictObject({ leadId: id, campaignId: id.nullable() })
  .extend(fields)
  .partial()
  .required({ leadId: true });
const patchInput = z.strictObject(fields).partial();

export const opportunityQuery = z.strictObject({
  campaignId: id.optional(),
  listId: id.optional(),
  ownerId: id.optional(),
  stageId: id.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().min(1).optional(), // email or company domain contains
  take: z.coerce.number().int().min(1).max(200).optional(),
  cursor: id.optional(),
});

/** Deals of soft-deleted leads are hidden here (analytics keeps them). */
function oppWhere(ws: string, q: z.output<typeof opportunityQuery>): Prisma.OpportunityWhereInput {
  const contains = q.q && { contains: q.q, mode: "insensitive" as const };
  return {
    workspaceId: ws,
    ...(q.campaignId && { campaignId: q.campaignId }),
    ...(q.ownerId && { ownerId: q.ownerId }),
    ...(q.stageId && { stageId: q.stageId }),
    ...((q.from || q.to) && { createdAt: { gte: q.from, lte: q.to } }),
    lead: {
      deletedAt: null,
      ...(q.listId && { listMembers: { some: { listId: q.listId } } }),
      ...(contains && { OR: [{ email: contains }, { companyDomain: contains }] }),
    },
  };
}

export async function listOpportunities(db: Db, ws: string, query: unknown) {
  const q = opportunityQuery.parse(query);
  const take = q.take ?? 50;
  const rows = await db.opportunity.findMany({
    where: oppWhere(ws, q),
    include: INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor && { cursor: { id: q.cursor } }),
  });
  const next = rows.length > take ? rows.pop()! : null;
  return { opportunities: await toApi(db, ws, rows), nextCursor: next?.id ?? null };
}

const CARDS = 200;
export async function pipelineBoard(db: Db, ws: string, query: unknown) {
  const where = oppWhere(ws, opportunityQuery.parse(query));
  const stages = await ensureStages(db, ws);
  const { currency } = await db.workspace.findUniqueOrThrow({
    where: { id: ws },
    select: { currency: true },
  });
  const sums = new Map(
    (
      await db.opportunity.groupBy({
        by: ["stageId"],
        where,
        _count: { _all: true },
        _sum: { value: true },
      })
    ).map((g) => [g.stageId, g]),
  );
  // shortcut: at most 200 cards per column (count and value stay exact); page a column once one holds more
  const cols: Row[][] = [];
  for (const s of stages)
    cols.push(
      await db.opportunity.findMany({
        where: { AND: [where, { stageId: s.id }] }, // keeps a stageId filter: cards agree with counts
        include: INCLUDE,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: CARDS + 1,
      }),
    );
  const cards = await toApi(
    db,
    ws,
    cols.flatMap((c) => c.slice(0, CARDS)),
  );
  return {
    currency,
    stages: stages.map((s, i) => {
      const g = sums.get(s.id);
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        count: g?._count._all ?? 0,
        value: (g?._sum.value ?? new Prisma.Decimal(0)).toFixed(2),
        opportunities: cards.filter((o) => o.stageId === s.id),
        more: cols[i]!.length > CARDS,
      };
    }),
  };
}

export async function getOpportunity(db: Db, ws: string, id: string) {
  const row = await db.opportunity.findFirst({ where: { id, workspaceId: ws }, include: INCLUDE });
  if (!row) throw notFound();
  return (await toApi(db, ws, [row]))[0]!;
}

/** 409 opportunity_exists when the (lead, campaign) pair already has one. Attribution from the lead's latest send in that campaign. */
export async function createOpportunity(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actor: Actor,
  input: unknown,
): Promise<ApiOpportunity> {
  const d = createInput.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      // KEY SHARE waits for a merge or delete holding the lead, then the re-read sees it gone
      await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${d.leadId} AND "workspaceId" = ${ws} FOR KEY SHARE`;
      const lead = await tx.lead.findFirst({
        where: { id: d.leadId, workspaceId: ws, deletedAt: null },
      });
      if (!lead) throw notFound();
      const camp = d.campaignId
        ? await tx.campaign.findFirst({
            where: { id: d.campaignId, workspaceId: ws },
            select: { id: true, plValue: true, ownerId: true },
          })
        : null;
      if (d.campaignId && !camp) throw new AccountError(400, "unknown_campaign");
      if (d.ownerId) await assertMembers(tx, ws, [d.ownerId]);
      const stageId = d.stageId ?? (await ensureStages(tx, ws)).find((s) => s.kind === "OPEN")!.id;
      const stage = await keyShare(tx, ws, stageId);
      if (!stage) throw notFound();
      const att = camp ? (await lastSends(tx, ws, [lead.id], camp.id)).get(lead.id) : undefined;
      const now = clock.now();
      const o = await tx.opportunity.create({
        data: {
          workspaceId: ws,
          leadId: lead.id,
          campaignId: camp?.id ?? null,
          stageId,
          title: d.title ?? (lead.companyName || lead.email),
          value: d.value ?? clamp(lead.plValue ?? camp?.plValue),
          cashCollected: d.cashCollected ?? 0,
          expectedCloseAt: d.expectedCloseAt ?? null,
          ownerId:
            d.ownerId !== undefined ? d.ownerId : (lead.ownerId ?? camp?.ownerId ?? actor ?? null),
          closedAt: stage.kind === "OPEN" ? null : now,
          stepId: att?.stepId ?? null,
          variantId: att?.variantId ?? null,
          accountId: att?.accountId ?? null,
        },
        include: INCLUDE,
      });
      await opened(tx, now, actor, o, stage.kind);
      return (await toApi(tx, ws, [o]))[0]!;
    });
  } catch (e) {
    throw isUnique(e) ? new AccountError(409, "opportunity_exists") : e;
  }
}

export async function updateOpportunity(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<ApiOpportunity> {
  const { stageId, ...p } = patchInput.parse(input);
  return prisma.$transaction(async (tx) => {
    if (!(await lockDeal(tx, ws, id))) throw notFound();
    if (p.ownerId) await assertMembers(tx, ws, [p.ownerId]);
    if (stageId && (await moveStage(tx, clock, ws, actor, id, stageId)) === "no_stage")
      throw notFound();
    if (Object.keys(p).length) {
      const o = await tx.opportunity.update({ where: { id }, data: p });
      await audit(
        tx,
        { workspaceId: ws, actorId: actor, at: clock.now() },
        "opportunity.update",
        id,
        {
          leadId: o.leadId,
          value: o.value.toFixed(2),
          cashCollected: o.cashCollected.toFixed(2),
        },
      );
    }
    const row = await tx.opportunity.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    return (await toApi(tx, ws, [row]))[0]!;
  });
}

export async function deleteOpportunity(
  prisma: PrismaClient,
  ws: string,
  actor: Actor,
  id: string,
) {
  await prisma.$transaction(async (tx) => {
    const o = await tx.opportunity.findFirst({
      where: { id, workspaceId: ws },
      select: { leadId: true },
    });
    if (!o) throw notFound();
    await tx.opportunity.deleteMany({ where: { id, workspaceId: ws } });
    await audit(tx, { workspaceId: ws, actorId: actor }, "opportunity.delete", id, {
      leadId: o.leadId,
    });
  });
}
