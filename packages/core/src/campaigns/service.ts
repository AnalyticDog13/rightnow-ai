import type { Campaign, CampaignStatus, Prisma, PrismaClient } from "@rightnow/db/client";
import { AccountError } from "../accounts/service";
import { audit } from "../audit";
import { localMidnightUtc } from "../schedule";
import { campaignCreateSchema, campaignPatchSchema, schedulesSchema } from "./schema";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;

/** Same shape as AccountError so the web layer maps it with the same helper. */
export class CampaignError extends AccountError {}

const notFound = () => new CampaignError(404, "Not found");
const ctx = (ws: string, actorId: Actor) => ({ workspaceId: ws, actorId });

/** Live (not soft-deleted) campaign of this workspace, or 404. */
export async function liveCampaign(db: Db | Tx, ws: string, id: string) {
  const c = await db.campaign.findFirst({ where: { id, workspaceId: ws, deletedAt: null } });
  if (!c) throw notFound();
  return c;
}

async function assertOwner(db: Db | Tx, ws: string, ownerId: string | null | undefined) {
  if (ownerId && !(await db.member.count({ where: { workspaceId: ws, userId: ownerId } })))
    throw new CampaignError(400, "unknown_owner");
}

/** Text-only sends no pixel, so it wins over open tracking (PS-CAMP-22). */
const norm = <T extends { textOnly?: boolean; trackOpens?: boolean }>(d: T, was?: Campaign) =>
  (d.textOnly ?? was?.textOnly) && (d.trackOpens ?? was?.trackOpens)
    ? { ...d, trackOpens: false }
    : d;

export async function createCampaign(prisma: Db, ws: string, actorId: Actor, input: unknown) {
  const d = campaignCreateSchema.parse(input);
  await assertOwner(prisma, ws, d.ownerId);
  return prisma.$transaction(async (tx) => {
    const c = await tx.campaign.create({ data: { ...norm(d), workspaceId: ws } });
    await audit(tx, ctx(ws, actorId), "campaign.create", c.id);
    return c;
  });
}

/** A patch while ACTIVE is allowed; the next claim reads the new values. */
export async function updateCampaign(
  prisma: Db,
  ws: string,
  actorId: Actor,
  id: string,
  patch: unknown,
) {
  const d = campaignPatchSchema.parse(patch);
  await assertOwner(prisma, ws, d.ownerId);
  return prisma.$transaction(async (tx) => {
    const was = await liveCampaign(tx, ws, id);
    // The schema sees only the patch; the cap applies to the merged values.
    if ((d.cc ?? was.cc).length + (d.bcc ?? was.bcc).length > 10)
      throw new CampaignError(400, "cc_bcc_limit");
    const c = await tx.campaign.update({ where: { id }, data: norm(d, was) });
    await audit(tx, ctx(ws, actorId), "campaign.update", id, { fields: Object.keys(d) });
    return c;
  });
}

export async function getCampaign(prisma: Db, ws: string, id: string) {
  const c = await prisma.campaign.findFirst({
    where: { id, workspaceId: ws, deletedAt: null },
    include: { schedules: true, accounts: { select: { accountId: true } } },
  });
  if (!c) throw notFound();
  return c;
}

export const listCampaigns = (prisma: Db, ws: string, status?: CampaignStatus) =>
  prisma.campaign.findMany({
    where: { workspaceId: ws, deletedAt: null, ...(status && { status }) },
    orderBy: { createdAt: "desc" },
  });

const nextDay = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Replaces the schedules and the start/end range of a campaign. */
export async function setSchedules(
  prisma: Db,
  ws: string,
  actorId: Actor,
  id: string,
  input: unknown,
) {
  const { schedules, startDate, endDate } = schedulesSchema.parse(input);
  if (startDate && endDate && endDate < startDate) throw new CampaignError(400, "end_before_start");
  return prisma.$transaction(async (tx) => {
    await liveCampaign(tx, ws, id);
    const dflt = (await tx.workspace.findUniqueOrThrow({ where: { id: ws } })).timezone;
    const rows = schedules.map((s) => ({ ...s, timezone: s.timezone ?? dflt, campaignId: id }));
    const zone = rows[0]!.timezone;
    await tx.campaignSchedule.deleteMany({ where: { campaignId: id } });
    await tx.campaignSchedule.createMany({ data: rows });
    await tx.campaign.update({
      where: { id },
      data: {
        startAt: startDate ? localMidnightUtc(startDate, zone) : null,
        endAt: endDate ? localMidnightUtc(nextDay(endDate), zone) : null,
      },
    });
    await audit(tx, ctx(ws, actorId), "campaign.update", id, { schedules: rows.length });
    return tx.campaignSchedule.findMany({ where: { campaignId: id }, orderBy: { id: "asc" } });
  });
}

/** Replaces the assigned accounts. A foreign or deleted id rejects the whole call. */
export async function setCampaignAccounts(
  prisma: Db,
  ws: string,
  actorId: Actor,
  id: string,
  accountIds: string[],
) {
  const ids = [...new Set(accountIds)];
  return prisma.$transaction(async (tx) => {
    await liveCampaign(tx, ws, id);
    const ok = await tx.emailAccount.count({
      where: { id: { in: ids }, workspaceId: ws, deletedAt: null },
    });
    if (ok !== ids.length) throw new CampaignError(400, "unknown_account");
    await tx.campaignAccount.deleteMany({ where: { campaignId: id } });
    await tx.campaignAccount.createMany({
      data: ids.map((accountId) => ({ campaignId: id, accountId })),
    });
    await audit(tx, ctx(ws, actorId), "campaign.update", id, { accounts: ids.length });
    return { accountIds: ids };
  });
}

/** PS-ACC-22: the live campaigns that use an account. */
export async function listAccountCampaigns(prisma: Db, ws: string, accountId: string) {
  const a = await prisma.emailAccount.findFirst({
    where: { id: accountId, workspaceId: ws, deletedAt: null },
  });
  if (!a) throw notFound();
  return prisma.campaign.findMany({
    where: { workspaceId: ws, deletedAt: null, accounts: { some: { accountId } } },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Status machine. Every move is one conditional UPDATE on the old state, so a concurrent change is a 409,
 * never a lost write. Pausing is immediate: the claim SQL (T09) checks `c.status = 'ACTIVE'`.
 */
const FROM = {
  pause: ["ACTIVE", "ACCOUNTS_UNHEALTHY", "BOUNCE_PROTECT"],
  archive: ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ACCOUNTS_UNHEALTHY", "BOUNCE_PROTECT"],
} satisfies Record<string, CampaignStatus[]>;
const TO = { pause: "PAUSED", archive: "ARCHIVED" } as const;

async function move(prisma: Db, ws: string, actorId: Actor, id: string, kind: keyof typeof FROM) {
  return prisma.$transaction(async (tx) => {
    const was = await liveCampaign(tx, ws, id);
    const r = await tx.campaign.updateMany({
      where: { id, workspaceId: ws, deletedAt: null, status: { in: FROM[kind] } },
      data: { status: TO[kind] },
    });
    if (r.count !== 1) throw new CampaignError(409, `cannot_${kind}_${was.status.toLowerCase()}`);
    await audit(tx, ctx(ws, actorId), `campaign.${kind}`, id, { from: was.status });
    return liveCampaign(tx, ws, id);
  });
}
export const pauseCampaign = (p: Db, ws: string, a: Actor, id: string) =>
  move(p, ws, a, id, "pause");
/**
 * Archive stops sending at once (the status leaves ACTIVE). RULE FOR T09: once ScheduledMessage exists, archive
 * and delete cancel the campaign's SCHEDULED and HELD rows in the same transaction and leave SENDING and
 * UNCERTAIN rows alone: the sender's result transaction and resolveUncertain finish those by row id.
 */
export const archiveCampaign = (p: Db, ws: string, a: Actor, id: string) =>
  move(p, ws, a, id, "archive");

/** Soft delete. An ACTIVE campaign is refused (pause or archive it first), so nothing in flight is orphaned. */
export async function deleteCampaign(prisma: Db, ws: string, actorId: Actor, id: string) {
  await prisma.$transaction(async (tx) => {
    const was = await liveCampaign(tx, ws, id);
    const r = await tx.campaign.updateMany({
      where: { id, workspaceId: ws, deletedAt: null, status: { not: "ACTIVE" } },
      data: { status: "ARCHIVED", deletedAt: new Date() },
    });
    if (r.count !== 1) throw new CampaignError(409, "campaign_active");
    await audit(tx, ctx(ws, actorId), "campaign.delete", id, { from: was.status });
  });
}

export type CampaignDisplayStatus =
  | "Draft"
  | "Active"
  | "Paused"
  | "Completed"
  | "Running Subsequences"
  | "Accounts Unhealthy"
  | "Bounce Protect"
  | "Archived";
const LABEL: Record<CampaignStatus, CampaignDisplayStatus> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
  ACCOUNTS_UNHEALTHY: "Accounts Unhealthy",
  BOUNCE_PROTECT: "Bounce Protect",
};
export const displayCampaignStatus = (
  c: Pick<Campaign, "status">,
  hasActiveSubsequence: boolean,
): CampaignDisplayStatus =>
  c.status === "COMPLETED" && hasActiveSubsequence ? "Running Subsequences" : LABEL[c.status];
