import type { Prisma, PrismaClient, VerificationStatus } from "@rightnow/db/client";
import { z } from "zod";
import { audit } from "../audit";
import { LeadError } from "./service";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;

const name = z.string().trim().min(1).max(100);
const ids = z.array(z.string().min(1)).min(1).max(1000);
const STATUSES: VerificationStatus[] = [
  ...["NOT_VERIFIED", "VERIFIED", "PENDING", "PENDING_JOB"],
  ...["INVALID", "RISKY", "CATCH_ALL", "JOB_CHANGE"],
] as VerificationStatus[];
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

async function ownList(tx: Tx | Db, ws: string, id: string) {
  const l = await tx.leadList.findFirst({ where: { id, workspaceId: ws } });
  if (!l) throw new LeadError(404, "Not found");
  return l;
}
/** Only live leads of this workspace may join a list. */
const liveIds = async (tx: Tx, ws: string, leadIds: string[]) =>
  (
    await tx.lead.findMany({
      where: { workspaceId: ws, deletedAt: null, id: { in: ids.parse(leadIds) } },
      select: { id: true },
    })
  ).map((l) => l.id);

export async function createList(prisma: Db, ws: string, actorId: Actor, input: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const l = await tx.leadList.create({ data: { workspaceId: ws, name: name.parse(input) } });
      await audit(tx, { workspaceId: ws, actorId }, "list.create", l.id);
      return l;
    });
  } catch (e) {
    throw isUnique(e) ? new LeadError(409, "list_exists") : e;
  }
}

export async function renameList(
  prisma: Db,
  ws: string,
  actorId: Actor,
  id: string,
  input: string,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await ownList(tx, ws, id);
      const l = await tx.leadList.update({ where: { id }, data: { name: name.parse(input) } });
      await audit(tx, { workspaceId: ws, actorId }, "list.rename", id);
      return l;
    });
  } catch (e) {
    throw isUnique(e) ? new LeadError(409, "list_exists") : e;
  }
}

/** Members are removed with the list; the leads stay. */
export async function deleteList(prisma: Db, ws: string, actorId: Actor, id: string) {
  await prisma.$transaction(async (tx) => {
    await ownList(tx, ws, id);
    await tx.leadList.delete({ where: { id } });
    await audit(tx, { workspaceId: ws, actorId }, "list.delete", id);
  });
}

/** Lists with their live-lead counts, straight from the database. */
export async function listLists(prisma: Db, ws: string) {
  const lists = await prisma.leadList.findMany({
    where: { workspaceId: ws },
    orderBy: { name: "asc" },
  });
  const counts = await prisma.leadListMember.groupBy({
    by: ["listId"],
    where: { list: { workspaceId: ws }, lead: { deletedAt: null } },
    _count: true,
  });
  const by = new Map(counts.map((c) => [c.listId, c._count]));
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt,
    count: by.get(l.id) ?? 0,
  }));
}

async function add(tx: Tx, ws: string, listId: string, leadIds: string[]) {
  const live = await liveIds(tx, ws, leadIds);
  const r = await tx.leadListMember.createMany({
    data: live.map((leadId) => ({ listId, leadId })),
    skipDuplicates: true,
  });
  return r.count;
}

export async function addToList(
  prisma: Db,
  ws: string,
  actorId: Actor,
  listId: string,
  leadIds: string[],
) {
  return prisma.$transaction(async (tx) => {
    await ownList(tx, ws, listId);
    const added = await add(tx, ws, listId, leadIds);
    await audit(tx, { workspaceId: ws, actorId }, "list.add", listId, { count: added });
    return { added };
  });
}

export async function removeFromList(
  prisma: Db,
  ws: string,
  actorId: Actor,
  listId: string,
  leadIds: string[],
) {
  return prisma.$transaction(async (tx) => {
    await ownList(tx, ws, listId);
    const r = await tx.leadListMember.deleteMany({
      where: { listId, leadId: { in: ids.parse(leadIds) } },
    });
    await audit(tx, { workspaceId: ws, actorId }, "list.remove", listId, { count: r.count });
    return { removed: r.count };
  });
}

export async function moveLeads(
  prisma: Db,
  ws: string,
  actorId: Actor,
  p: { leadIds: string[]; fromListId: string; toListId: string },
) {
  if (p.fromListId === p.toListId) throw new LeadError(400, "same_list");
  return prisma.$transaction(async (tx) => {
    await ownList(tx, ws, p.fromListId);
    await ownList(tx, ws, p.toListId);
    const inSource = (
      await tx.leadListMember.findMany({
        where: { listId: p.fromListId, leadId: { in: ids.parse(p.leadIds) } },
        select: { leadId: true },
      })
    ).map((m) => m.leadId);
    await tx.leadListMember.deleteMany({
      where: { listId: p.fromListId, leadId: { in: inSource } },
    });
    const moved = inSource.length ? await add(tx, ws, p.toListId, inSource) : 0;
    const skipped = p.leadIds.length - moved; // not in the source list, or not a live lead of this workspace
    await audit(tx, { workspaceId: ws, actorId }, "list.move", p.toListId, {
      from: p.fromListId,
      count: moved,
      skipped,
    });
    return { moved, skipped };
  });
}

/** Verification status counts of the list's live leads (every status present, zeros included). */
export async function listStats(prisma: Db, ws: string, listId: string) {
  await ownList(prisma, ws, listId);
  const rows = await prisma.lead.groupBy({
    by: ["verificationStatus"],
    where: { workspaceId: ws, deletedAt: null, listMembers: { some: { listId } } },
    _count: true,
  });
  const out = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<VerificationStatus, number>;
  for (const r of rows) out[r.verificationStatus] = r._count;
  return out;
}
