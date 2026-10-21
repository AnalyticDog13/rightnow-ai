import type { Lead, LeadLabel, Prisma, PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { AccountError } from "../accounts/service";
import { CAMPAIGN_LEAD_STATUSES, campaignLeadStatusWhere } from "../campaigns/lead-status";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { companyDomainOf } from "./domain";
import { editHooks, openInOtherLive, stopOpenCampaignLeads } from "../campaigns/hooks";
import { hashValue, suppress, suppressedEmails } from "./suppression";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;

/** Same shape as AccountError so the web layer maps both with one helper. */
export class LeadError extends AccountError {}

const text = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => text(max).nullable();
const scalar = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
const interest = z.literal([1, 2, 3, 4, 0, -1, -2, -3, -4]);

const fields = {
  firstName: opt(100),
  lastName: opt(100),
  companyName: opt(200),
  companyDomain: opt(253),
  jobTitle: opt(200),
  website: opt(500),
  industry: opt(200),
  phone: opt(50),
  personalization: z.string().max(10_000).nullable(),
  customFields: z.record(z.string().max(100), scalar),
  tags: z.array(text(50)).max(100),
  labels: z.array(text(50)).max(100),
  ownerId: text(100).nullable(),
  source: opt(200),
  lawfulBasis: opt(200),
  country: opt(100),
  plValue: z.number().nonnegative().nullable(),
};
export const createLeadInput = z
  .strictObject({ email: z.string().trim().toLowerCase().pipe(z.email().max(320)) })
  .extend(z.object(fields).partial().shape);
export const updateLeadInput = z
  .strictObject({ ...fields, interestStatus: interest.nullable() })
  .partial();

const PUBLIC = [
  ...["id", "email", "interestStatus", "verificationStatus", "espType", "esg", "enrichmentStatus"],
  ...["emailsSent", "opens", "clicks", "replies", "lastContactedAt", "lastOpenAt", "lastReplyAt"],
  ...[
    "lastClickAt",
    "lastInterestChangeAt",
    "lastTouchAt",
    "lastSenderAccountId",
    "lastEngagement",
  ],
  ...["mergedIntoId", "createdAt", "updatedAt", "deletedAt", "importJobId", ...Object.keys(fields)],
];
export type ApiLead = Omit<Lead, "workspaceId" | "plValue"> & { plValue: number | null };
/** Allowlist serializer: only listed columns leave the service (plValue as a number). */
export function toApiLead(l: Lead): ApiLead {
  const o = Object.fromEntries(PUBLIC.map((k) => [k, l[k as keyof Lead]]));
  return { ...o, plValue: l.plValue === null ? null : Number(l.plValue) } as ApiLead;
}

const uniq = <T>(a: T[]) => [...new Set(a)];
const notFound = () => new LeadError(404, "Not found");
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

async function liveLead(db: Tx, ws: string, id: string) {
  const l = await db.lead.findFirst({ where: { id, workspaceId: ws, deletedAt: null } });
  if (!l) throw notFound();
  return l;
}

/** Owners must be members of this workspace. */
async function assertMembers(db: Tx, ws: string, ids: string[]) {
  const n = await db.member.count({ where: { workspaceId: ws, userId: { in: ids } } });
  if (n !== new Set(ids).size) throw new LeadError(400, "unknown_owner");
}

/** 409 while a send for any of these leads is in flight or of unknown outcome. Locks those rows. No-op until the send tables exist. */
async function assertNoSendInFlight(tx: Tx, leadIds: string[]) {
  const t = (
    await tx.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('"ScheduledMessage"')::text AS t`
  )[0]?.t;
  if (!t) return;
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT m."status"::text AS status FROM "ScheduledMessage" m
    WHERE m."campaignLeadId" IN (SELECT id FROM "CampaignLead" WHERE "leadId" = ANY(${leadIds}))
    FOR UPDATE OF m`;
  if (rows.some((r) => r.status === "SENDING" || r.status === "UNCERTAIN"))
    throw new LeadError(409, "send_in_progress");
}

export async function createLead(prisma: Db, ws: string, actorId: Actor, input: unknown) {
  const { customFields, plValue, ...d } = createLeadInput.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      if (d.ownerId) await assertMembers(tx, ws, [d.ownerId]);
      const lead = await tx.lead.create({
        data: {
          ...d,
          companyDomain: d.companyDomain ?? companyDomainOf(d.email),
          tags: uniq(d.tags ?? []),
          labels: uniq(d.labels ?? []),
          ...(customFields && { customFields }),
          ...(plValue !== undefined && { plValue }),
          workspaceId: ws,
        },
      });
      await audit(tx, { workspaceId: ws, actorId }, "lead.create", lead.id);
      return toApiLead(lead);
    });
  } catch (e) {
    throw isUnique(e) ? new LeadError(409, "lead_exists") : e;
  }
}

export async function getLead(prisma: Db, ws: string, id: string) {
  return toApiLead(await liveLead(prisma, ws, id));
}

/** I9: the caller stores the interest; Not interested (-1) puts the address on the blocklist. T10b adds the CampaignLead effects. */
export async function applyInterestChange(
  tx: Tx,
  _clock: Clock,
  ws: string,
  leadId: string,
  interest: number | null,
) {
  if (interest !== -1) return;
  const l = await tx.lead.findFirst({
    where: { id: leadId, workspaceId: ws },
    select: { email: true },
  });
  if (l) await suppress(tx, ws, [{ kind: "EMAIL", value: l.email }], "NOT_INTERESTED", "status");
}

export async function updateLead(
  prisma: Db,
  clock: Clock,
  ws: string,
  id: string,
  patch: unknown,
  actorId?: Actor,
) {
  const { plValue, ...p } = updateLeadInput.parse(patch);
  return prisma.$transaction(async (tx) => {
    await liveLead(tx, ws, id);
    if (p.ownerId) await assertMembers(tx, ws, [p.ownerId]);
    // Lock order: Suppression before Lead (same in gdprDeleteLead and bulk set_interest).
    if (p.interestStatus !== undefined)
      await applyInterestChange(tx, clock, ws, id, p.interestStatus);
    const lead = await tx.lead.update({
      where: { id },
      data: {
        ...p,
        ...(p.tags && { tags: uniq(p.tags) }),
        ...(p.labels && { labels: uniq(p.labels) }),
        ...(plValue !== undefined && { plValue }),
        ...(p.interestStatus !== undefined && { lastInterestChangeAt: clock.now() }),
      },
    });
    await audit(tx, { workspaceId: ws, actorId, at: clock.now() }, "lead.update", id, {
      fields: Object.keys(p),
    });
    return toApiLead(lead);
  });
}

export const leadQuery = z
  .strictObject({
    q: z.string().trim().min(1).optional(),
    tag: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    interestStatus: z.coerce.number().pipe(interest).optional(),
    verificationStatus: z
      .enum([
        ...["NOT_VERIFIED", "VERIFIED", "PENDING", "PENDING_JOB"],
        ...["INVALID", "RISKY", "CATCH_ALL", "JOB_CHANGE"],
      ] as const)
      .optional(),
    ownerId: z.string().min(1).optional(),
    listId: z.string().min(1).optional(),
    campaignId: z.string().min(1).optional(),
    status: z.enum(CAMPAIGN_LEAD_STATUSES).optional(), // CampaignLead status; applies only together with campaignId
    openedNoReply: z.union([z.boolean(), z.stringbool()]).optional(),
    lastContactedFrom: z.coerce.date().optional(),
    lastContactedTo: z.coerce.date().optional(),
    custom: z.strictObject({ key: z.string().min(1), contains: z.string().min(1) }).optional(),
    customKey: z.string().min(1).optional(), // flat form for query strings
    customContains: z.string().min(1).optional(),
    ids: z
      .union([
        z.array(z.string().min(1)).max(1000),
        z
          .string()
          .min(1)
          .transform((s) => s.split(","))
          .pipe(z.array(z.string().min(1)).max(1000)), // over the cap is an error, never a silent cut
      ])
      .optional(), // comma separated in a query string: "export selected"
    cursor: z.string().min(1).optional(),
    take: z.coerce.number().int().min(1).max(100).optional(),
  })
  .transform(({ customKey, customContains, ids, ...q }) => ({
    ...q,
    ...(ids && { ids }),
    ...(customKey && customContains && { custom: { key: customKey, contains: customContains } }),
  }));
export type LeadQuery = z.input<typeof leadQuery>;

/** The Prisma filter behind a parsed lead query (paging fields ignored). Shared by the list and by enrollment. */
export function leadWhere(ws: string, q: z.output<typeof leadQuery>): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];
  if (q.q) {
    const contains = { contains: q.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { email: contains },
        { firstName: contains },
        { lastName: contains },
        { companyName: contains },
      ],
    });
  }
  if (q.openedNoReply) and.push({ opens: { gt: 0 }, replies: 0 });
  if (q.custom)
    and.push({
      customFields: {
        path: [q.custom.key],
        string_contains: q.custom.contains,
        mode: "insensitive",
      },
    });
  return {
    workspaceId: ws,
    deletedAt: null,
    ...(q.ids && { id: { in: q.ids } }),
    ...(q.tag && { tags: { has: q.tag } }),
    ...(q.label && { labels: { has: q.label } }),
    ...(q.interestStatus !== undefined && { interestStatus: q.interestStatus }),
    ...(q.verificationStatus && { verificationStatus: q.verificationStatus }),
    ...(q.ownerId && { ownerId: q.ownerId }),
    ...(q.listId && { listMembers: { some: { listId: q.listId, list: { workspaceId: ws } } } }),
    ...(q.campaignId && {
      campaignLeads: {
        some: {
          campaignId: q.campaignId,
          workspaceId: ws,
          ...(q.status && campaignLeadStatusWhere(q.status)),
        },
      },
    }),
    ...((q.lastContactedFrom || q.lastContactedTo) && {
      lastContactedAt: { gte: q.lastContactedFrom, lte: q.lastContactedTo },
    }),
    AND: and,
  };
}

export async function listLeads(prisma: Db, ws: string, query: LeadQuery) {
  const q = leadQuery.parse(query);
  const take = q.take ?? 50;
  const where = leadWhere(ws, q);
  const rows = await prisma.lead.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(q.cursor && { cursor: { id: q.cursor } }),
  });
  const next = rows.length > take ? rows.pop()! : null;
  // `total` is a database count of the whole filter, taken on the first page only
  const total = q.cursor ? undefined : await prisma.lead.count({ where });
  return { leads: rows.map(toApiLead), nextCursor: next?.id ?? null, total };
}

export async function softDeleteLead(
  prisma: Db,
  clock: Clock,
  ws: string,
  id: string,
  actorId?: Actor,
) {
  await prisma.$transaction(async (tx) => {
    const r = await tx.lead.updateMany({
      where: { id, workspaceId: ws, deletedAt: null },
      data: { deletedAt: clock.now() },
    });
    if (!r.count) throw notFound();
    await stopOpenCampaignLeads(tx, ws, [id], "SKIPPED", clock.now());
    await audit(tx, { workspaceId: ws, actorId, at: clock.now() }, "lead.delete", id);
  });
}

/**
 * PS-LEAD-24. One transaction erases every row for the address (soft-deleted ones and rows merged into it
 * included, I10), keeps a hashed GDPR_ERASURE suppression and audits hashes only.
 * ImportJob.data is not scanned: it is cleared when its job ends, and a re-run skips the address as
 * `blocklisted` because the suppression now exists.
 */
export async function gdprDeleteLead(
  prisma: Db,
  clock: Clock,
  ws: string,
  id: string,
  actorId?: Actor,
) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.lead.findFirst({ where: { id, workspaceId: ws } });
    if (!target) throw notFound();
    const pick = { id: true, email: true };
    let set = await tx.lead.findMany({
      where: { workspaceId: ws, email: target.email },
      select: pick,
    });
    for (;;) {
      const ids = set.map((l) => l.id);
      const more = await tx.lead.findMany({
        where: { workspaceId: ws, mergedIntoId: { in: ids }, id: { notIn: ids } },
        select: pick,
      });
      if (!more.length) break;
      set = [...set, ...more];
    }
    const ids = set.map((l) => l.id);
    await assertNoSendInFlight(tx, ids);
    // Lock order: Suppression writes before the Lead delete (as in updateLead).
    const hashes = uniq(set.map((l) => hashValue(l.email)));
    await tx.suppression.createMany({
      data: hashes.map((valueHash) => ({
        workspaceId: ws,
        kind: "EMAIL" as const,
        valueHash,
        reason: "GDPR_ERASURE" as const,
        source: "gdpr",
      })),
      skipDuplicates: true,
    });
    await tx.suppression.updateMany({
      where: { workspaceId: ws, kind: "EMAIL", valueHash: { in: hashes } },
      data: { value: null },
    });
    // D20: an older row for the address (manual, unsubscribe, bounce...) becomes an erasure record too, so it cannot be removed under weaker rules; COMPLAINT is already protected
    await tx.suppression.updateMany({
      where: {
        workspaceId: ws,
        kind: "EMAIL",
        valueHash: { in: hashes },
        reason: { notIn: ["COMPLAINT", "GDPR_ERASURE"] },
      },
      data: { reason: "GDPR_ERASURE" },
    });
    await tx.lead.deleteMany({ where: { workspaceId: ws, id: { in: ids } } });
    await audit(tx, { workspaceId: ws, actorId, at: clock.now() }, "lead.gdpr_delete", undefined, {
      hashes,
    });
    return { deleted: ids.length };
  });
}

const FILL = [
  ...["firstName", "lastName", "companyName", "companyDomain", "jobTitle", "website", "industry"],
  ...["phone", "personalization", "esg", "enrichmentStatus", "plValue", "ownerId", "source"],
  ...["lawfulBasis", "country", "interestStatus", "lastSenderAccountId", "lastEngagement"],
] as const;
const LATEST = [
  ...["lastContactedAt", "lastOpenAt", "lastReplyAt", "lastClickAt", "lastTouchAt"],
] as const;
const blank = (v: unknown) => v === null || v === undefined || v === "";

/** Kept lead's non-empty fields win; blanks are filled from the merged lead, which is then soft-deleted. */
export async function mergeLeads(
  prisma: Db,
  clock: Clock,
  ws: string,
  input: unknown,
  actorId?: Actor,
) {
  const { keepId, mergeId } = z
    .strictObject({ keepId: z.string().min(1), mergeId: z.string().min(1) })
    .parse(input);
  if (keepId === mergeId) throw new LeadError(400, "same_lead");
  return prisma.$transaction(async (tx) => {
    // Lock order: enrollment lock 726004 first (as enrollBatch does), then Lead rows. Enrollment's CampaignLead
    // insert key-share-locks Lead, so the reverse order would deadlock against a concurrent enroll.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(726004, hashtext(${ws}))`;
    await assertNoSendInFlight(tx, [keepId, mergeId]); // I4: ScheduledMessage before Lead
    // Lock both rows in id order, then re-check they are live: concurrent A<-B and B<-A cannot both win.
    await tx.$queryRaw`SELECT id FROM "Lead" WHERE "workspaceId" = ${ws} AND id = ANY(${[keepId, mergeId]}) ORDER BY id FOR UPDATE`;
    const keep = await liveLead(tx, ws, keepId);
    const from = await liveLead(tx, ws, mergeId);
    const data: Prisma.LeadUpdateInput = {
      customFields: { ...(from.customFields as object), ...(keep.customFields as object) },
      tags: uniq([...keep.tags, ...from.tags]),
      labels: uniq([...keep.labels, ...from.labels]),
      emailsSent: keep.emailsSent + from.emailsSent,
      opens: keep.opens + from.opens,
      clicks: keep.clicks + from.clicks,
      replies: keep.replies + from.replies,
    };
    for (const f of FILL)
      if (blank(keep[f]) && !blank(from[f])) Object.assign(data, { [f]: from[f] });
    for (const f of LATEST) {
      const t = Math.max(keep[f]?.getTime() ?? 0, from[f]?.getTime() ?? 0);
      if (t) Object.assign(data, { [f]: new Date(t) });
    }
    const merged = await tx.lead.update({ where: { id: keepId }, data });
    const members = await tx.leadListMember.findMany({ where: { leadId: mergeId } });
    await tx.leadListMember.createMany({
      data: members.map((m) => ({ listId: m.listId, leadId: keepId })),
      skipDuplicates: true,
    });
    await tx.leadListMember.deleteMany({ where: { leadId: mergeId } });
    // Enrollments follow the kept lead unless it is blocklisted, already in that campaign, or the move would break the
    // cross-campaign rule (same check and lock as enrollment; duplicateOk exempts). The rest stop. Rows are re-planned.
    const blocked = (await suppressedEmails(tx, ws, [keep.email])).size > 0;
    const there = new Set(
      (await tx.campaignLead.findMany({ where: { workspaceId: ws, leadId: keepId } })).map(
        (c) => c.campaignId,
      ),
    );
    const open = await tx.campaignLead.findMany({
      where: { workspaceId: ws, leadId: mergeId, state: { in: ["QUEUED", "ACTIVE", "PAUSED"] } },
    });
    const moved: string[] = [];
    for (const c of open) {
      if (blocked || there.has(c.campaignId)) continue;
      if (!c.duplicateOk && (await openInOtherLive(tx, ws, [keepId], c.campaignId)).size) continue;
      await tx.campaignLead.update({ where: { id: c.id }, data: { leadId: keepId } });
      moved.push(c.id);
    }
    if (moved.length) await editHooks.cancelOpenRows(tx, moved);
    await stopOpenCampaignLeads(tx, ws, [mergeId], blocked ? "SUPPRESSED" : "SKIPPED", clock.now());
    await tx.lead.update({
      where: { id: mergeId },
      data: { deletedAt: clock.now(), mergedIntoId: keepId },
    });
    await audit(tx, { workspaceId: ws, actorId, at: clock.now() }, "lead.merge", keepId, {
      mergedId: mergeId,
    });
    return toApiLead(merged);
  });
}

export const bulkInput = z.strictObject({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  action: z.enum([
    ...["assign_round_robin", "set_owner", "set_interest", "add_tags", "remove_tags", "delete"],
  ] as const),
  value: z
    .union([z.string(), z.number(), z.array(z.string().min(1)).max(100), z.null()])
    .optional(),
});

export async function bulkLeads(
  prisma: Db,
  clock: Clock,
  ws: string,
  input: unknown,
  actorId?: Actor,
) {
  const { ids, action, value } = bulkInput.parse(input);
  const strs = () => z.array(text(50)).min(1).parse(value);
  return prisma.$transaction(
    async (tx) => {
      const base = { workspaceId: ws, deletedAt: null, id: { in: ids } };
      const leads = await tx.lead.findMany({
        where: base,
        select: { id: true },
        orderBy: { id: "asc" },
      });
      const found = leads.map((l) => l.id);
      if (action === "assign_round_robin") {
        const users = uniq(z.array(text(100)).min(1).parse(value));
        await assertMembers(tx, ws, users);
        const owners = found.map((_, i) => users[i % users.length]!);
        await tx.$executeRaw`UPDATE "Lead" l SET "ownerId" = v.o, "updatedAt" = now() FROM unnest(${found}::text[], ${owners}::text[]) AS v(id, o) WHERE l.id = v.id AND l."workspaceId" = ${ws}`;
      } else if (action === "set_owner") {
        const owner = z
          .string()
          .min(1)
          .nullable()
          .parse(value ?? null);
        if (owner) await assertMembers(tx, ws, [owner]);
        await tx.lead.updateMany({ where: base, data: { ownerId: owner } });
      } else if (action === "set_interest") {
        const v = interest.nullable().parse(value ?? null);
        if (v === -1) {
          const rows = await tx.lead.findMany({ where: base, select: { email: true } });
          await suppress(
            tx,
            ws,
            rows.map((r) => ({ kind: "EMAIL", value: r.email })),
            "NOT_INTERESTED",
            "status",
          );
        }
        await tx.lead.updateMany({
          where: base,
          data: { interestStatus: v, lastInterestChangeAt: clock.now() },
        });
      } else if (action === "add_tags") {
        await tx.$executeRaw`UPDATE "Lead" SET "updatedAt" = now(), "tags" = ARRAY(SELECT DISTINCT unnest("tags" || ${strs()}::text[])) WHERE "workspaceId" = ${ws} AND "id" = ANY(${found})`;
      } else if (action === "remove_tags") {
        await tx.$executeRaw`UPDATE "Lead" SET "updatedAt" = now(), "tags" = ARRAY(SELECT t FROM unnest("tags") t WHERE t <> ALL(${strs()}::text[])) WHERE "workspaceId" = ${ws} AND "id" = ANY(${found})`;
      } else {
        await tx.lead.updateMany({ where: base, data: { deletedAt: clock.now() } });
        await stopOpenCampaignLeads(tx, ws, found, "SKIPPED", clock.now());
      }
      await audit(tx, { workspaceId: ws, actorId, at: clock.now() }, "lead.bulk", undefined, {
        action,
        count: found.length,
      });
      return { affected: found.length };
    },
    { timeout: 30_000 },
  ); // set-based statements; same budget as the planner's per-campaign transaction
}

// Lead labels (PS-LEAD-06): a lead's `labels` array holds label names.
export const labelInput = z.strictObject({
  name: text(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  positive: z.boolean(),
  aiDescription: z.string().max(1000).nullable(),
});

export const listLabels = (prisma: Db, ws: string): Promise<LeadLabel[]> =>
  prisma.leadLabel.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" } });

export async function createLabel(prisma: Db, ws: string, actorId: Actor, input: unknown) {
  const d = labelInput.partial({ positive: true, aiDescription: true }).parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const l = await tx.leadLabel.create({ data: { ...d, workspaceId: ws } });
      await audit(tx, { workspaceId: ws, actorId }, "label.create", l.id);
      return l;
    });
  } catch (e) {
    throw isUnique(e) ? new LeadError(409, "label_exists") : e;
  }
}

export async function updateLabel(
  prisma: Db,
  ws: string,
  id: string,
  patch: unknown,
  actorId?: Actor,
) {
  const p = labelInput.partial().parse(patch);
  try {
    return await prisma.$transaction(async (tx) => {
      const cur = await tx.leadLabel.findFirst({ where: { id, workspaceId: ws } });
      if (!cur) throw notFound();
      const l = await tx.leadLabel.update({ where: { id }, data: p });
      if (p.name && p.name !== cur.name)
        await tx.$executeRaw`UPDATE "Lead" SET "labels" = array_replace("labels", ${cur.name}, ${p.name}) WHERE "workspaceId" = ${ws} AND ${cur.name} = ANY("labels")`;
      await audit(tx, { workspaceId: ws, actorId }, "label.update", id, {
        fields: Object.keys(p),
      });
      return l;
    });
  } catch (e) {
    throw isUnique(e) ? new LeadError(409, "label_exists") : e;
  }
}

export async function deleteLabel(prisma: Db, ws: string, id: string, actorId?: Actor) {
  await prisma.$transaction(async (tx) => {
    const cur = await tx.leadLabel.findFirst({ where: { id, workspaceId: ws } });
    if (!cur) throw notFound();
    await tx.leadLabel.delete({ where: { id } });
    await tx.$executeRaw`UPDATE "Lead" SET "labels" = array_remove("labels", ${cur.name}) WHERE "workspaceId" = ${ws} AND ${cur.name} = ANY("labels")`;
    await audit(tx, { workspaceId: ws, actorId }, "label.delete", id);
  });
}
