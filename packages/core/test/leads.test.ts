import { createHash } from "node:crypto";
import { createTestDb, expectIsolated } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { companyDomainOf } from "../src/leads/domain";
import {
  bulkLeads,
  createLabel,
  createLead,
  deleteLabel,
  gdprDeleteLead,
  getLead,
  listLabels,
  listLeads,
  mergeLeads,
  softDeleteLead,
  updateLabel,
  updateLead,
} from "../src/leads/service";
import { isSuppressed } from "../src/leads/suppression";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let other: string;
const T0 = new Date("2026-10-20T10:00:00Z");
const clock = fixedClock(T0);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let n = 0;
const mk = (over: Record<string, unknown> = {}) =>
  createLead(db.prisma, ws, null, { email: `l${++n}@acme.test`, ...over });
const audits = (action: string) =>
  db.prisma.auditLog.findMany({ where: { workspaceId: ws, action } });

beforeAll(async () => {
  db = await createTestDb();
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w-leads" } })).id;
  other = (await db.prisma.workspace.create({ data: { name: "O", slug: "o-leads" } })).id;
});
afterAll(() => db.drop());

describe("lead create", () => {
  test("lowercases email; duplicates 409 until soft-deleted; other workspace is independent", async () => {
    const a = await createLead(db.prisma, ws, null, { email: "A@X.test" });
    expect(a.email).toBe("a@x.test");
    await expect(createLead(db.prisma, ws, null, { email: "a@x.test" })).rejects.toMatchObject({
      status: 409,
      message: "lead_exists",
    });
    await createLead(db.prisma, other, null, { email: "a@x.test" });
    await expect(softDeleteLead(db.prisma, clock, other, a.id)).rejects.toMatchObject({
      status: 404,
    });
    await softDeleteLead(db.prisma, clock, ws, a.id);
    await expect(getLead(db.prisma, ws, a.id)).rejects.toMatchObject({ status: 404 });
    await createLead(db.prisma, ws, null, { email: "a@x.test" });
    expect((await audits("lead.delete")).length).toBe(1);
  });

  test("company domain: free mail gives null, otherwise the email domain", async () => {
    expect(companyDomainOf("jo@acme.test")).toBe("acme.test");
    expect(companyDomainOf("jo@gmail.com")).toBeNull();
    expect((await mk({ email: "co@acme.test" })).companyDomain).toBe("acme.test");
    expect((await mk({ email: "co@gmail.com" })).companyDomain).toBeNull();
  });

  test("rejects unknown keys and an owner outside the workspace", async () => {
    await expect(mk({ workspaceId: other })).rejects.toThrow();
    await expect(mk({ ownerId: "nobody" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("lead update", () => {
  test("interest stamps lastInterestChangeAt and audits; bad values are rejected; foreign is 404", async () => {
    const l = await mk();
    const u = await updateLead(db.prisma, clock, ws, l.id, { interestStatus: 1 });
    expect(u.lastInterestChangeAt).toEqual(T0);
    expect((await audits("lead.update")).some((a) => a.target === l.id)).toBe(true);
    await expect(updateLead(db.prisma, clock, ws, l.id, { interestStatus: 7 })).rejects.toThrow();
    await expect(
      updateLead(db.prisma, clock, ws, l.id, { customFields: { a: {} } }),
    ).rejects.toThrow();
    await expect(
      updateLead(db.prisma, clock, other, l.id, { firstName: "x" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("not interested suppresses", async () => {
    const l = await mk({ email: "ni@acme.test" });
    await updateLead(db.prisma, clock, ws, l.id, { interestStatus: -1 });
    const s = await db.prisma.suppression.findFirst({
      where: { workspaceId: ws, valueHash: sha("ni@acme.test") },
    });
    expect(s).toMatchObject({ reason: "NOT_INTERESTED", source: "status", kind: "EMAIL" });
    expect(await isSuppressed(db.prisma, ws, "NI@acme.test")).toBe(true);
    expect(await isSuppressed(db.prisma, other, "ni@acme.test")).toBe(false);
  });
});

describe("lead list", () => {
  test("is workspace scoped", async () => {
    await expectIsolated({
      prisma: db.prisma,
      seed: async (w) => {
        await createLead(db.prisma, w, null, { email: "iso@acme.test" });
      },
      read: async (w) => (await listLeads(db.prisma, w, {})).leads,
    });
  });

  test("openedNoReply, custom contains, tag", async () => {
    const w = (await db.prisma.workspace.create({ data: { name: "F", slug: "w-filter" } })).id;
    const c = (email: string, data: Record<string, unknown>) =>
      db.prisma.lead.create({ data: { workspaceId: w, email, ...data } });
    const a = await c("a@acme.test", {
      opens: 2,
      replies: 0,
      customFields: { city: "Berlin" },
      tags: ["t"],
    });
    await c("b@acme.test", { opens: 2, replies: 1 });
    await c("c@acme.test", { opens: 0 });
    const ids = async (q: object) => (await listLeads(db.prisma, w, q)).leads.map((l) => l.id);
    expect(await ids({ openedNoReply: true })).toEqual([a.id]);
    expect(await ids({ custom: { key: "city", contains: "ber" } })).toEqual([a.id]);
    expect(await ids({ customKey: "city", customContains: "ber" })).toEqual([a.id]);
    expect(await ids({ tag: "t" })).toEqual([a.id]);
    expect(await ids({ q: "B@ACME" })).toHaveLength(1);
  });

  test("cursor pagination: 50/50/20 with no repeats", async () => {
    const w = (await db.prisma.workspace.create({ data: { name: "P", slug: "w-page" } })).id;
    await db.prisma.lead.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({ workspaceId: w, email: `p${i}@acme.test` })),
    });
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const r = await listLeads(db.prisma, w, { take: 50, cursor });
      sizes.push(r.leads.length);
      seen.push(...r.leads.map((l) => l.id));
      cursor = r.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    await expect(listLeads(db.prisma, w, { take: 101 })).rejects.toThrow();
  });
});

describe("bulk", () => {
  async function users(count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `u${++n}`;
      await db.prisma.user.create({ data: { id, name: id, email: `${id}@x.io` } });
      await db.prisma.member.create({
        data: { id: `m${id}`, workspaceId: ws, userId: id, role: "member" },
      });
      ids.push(id);
    }
    return ids;
  }

  test("assign_round_robin cycles users in id order; ghosts, 1001 ids and foreign workspaces are refused", async () => {
    const [u1, u2] = await users(2);
    const leads = await Promise.all([1, 2, 3, 4, 5].map(() => mk()));
    const ids = leads.map((l) => l.id);
    const r = await bulkLeads(db.prisma, clock, ws, {
      ids,
      action: "assign_round_robin",
      value: [u1, u2],
    });
    expect(r.affected).toBe(5);
    const rows = await db.prisma.lead.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
    });
    expect(rows.map((l) => l.ownerId)).toEqual([u1, u2, u1, u2, u1]);
    await expect(
      bulkLeads(db.prisma, clock, ws, { ids, action: "assign_round_robin", value: ["ghost"] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      bulkLeads(db.prisma, clock, ws, {
        ids: Array.from({ length: 1001 }, (_, i) => `x${i}`),
        action: "delete",
      }),
    ).rejects.toThrow();
    expect((await bulkLeads(db.prisma, clock, other, { ids, action: "delete" })).affected).toBe(0);
    expect(await db.prisma.lead.count({ where: { id: { in: ids }, deletedAt: null } })).toBe(5);
  });

  test("tags, interest and delete", async () => {
    const l = await mk({ tags: ["a", "b"] });
    const ids = [l.id];
    await bulkLeads(db.prisma, clock, ws, { ids, action: "add_tags", value: ["b", "c"] });
    expect((await getLead(db.prisma, ws, l.id)).tags.sort()).toEqual(["a", "b", "c"]);
    await bulkLeads(db.prisma, clock, ws, { ids, action: "remove_tags", value: ["a"] });
    expect((await getLead(db.prisma, ws, l.id)).tags.sort()).toEqual(["b", "c"]);
    await bulkLeads(db.prisma, clock, ws, { ids, action: "set_interest", value: -1 });
    expect(await isSuppressed(db.prisma, ws, l.email)).toBe(true);
    await bulkLeads(db.prisma, clock, ws, { ids, action: "delete" });
    await expect(getLead(db.prisma, ws, l.id)).rejects.toMatchObject({ status: 404 });
    expect((await audits("lead.bulk")).length).toBeGreaterThan(0);
  });
});

describe("merge", () => {
  test("keep wins, blanks filled, unions, counters summed, merged soft-deleted", async () => {
    const keep = await mk({ firstName: "A", tags: ["x"], customFields: { k: 1 } });
    const from = await mk({
      firstName: "B",
      phone: "1",
      tags: ["y"],
      customFields: { k: 2, j: 3 },
    });
    await db.prisma.lead.update({ where: { id: keep.id }, data: { opens: 1 } });
    await db.prisma.lead.update({ where: { id: from.id }, data: { opens: 2 } });
    const list = await db.prisma.leadList.create({ data: { workspaceId: ws, name: "L" } });
    await db.prisma.leadListMember.create({ data: { listId: list.id, leadId: from.id } });
    await expect(
      mergeLeads(db.prisma, clock, other, { keepId: keep.id, mergeId: from.id }),
    ).rejects.toMatchObject({ status: 404 });
    const m = await mergeLeads(db.prisma, clock, ws, { keepId: keep.id, mergeId: from.id });
    expect(m).toMatchObject({ firstName: "A", phone: "1", tags: ["x", "y"], opens: 3 });
    expect(m.customFields).toEqual({ k: 1, j: 3 });
    const gone = await db.prisma.lead.findUniqueOrThrow({ where: { id: from.id } });
    expect(gone.deletedAt).toEqual(T0);
    expect(gone.mergedIntoId).toBe(keep.id);
    expect((await db.prisma.leadListMember.findMany({ where: { leadId: keep.id } })).length).toBe(
      1,
    );
    expect((await audits("lead.merge")).length).toBe(1);
  });
});

describe("gdpr delete", () => {
  test("leaves no address behind, keeps the hashed suppression, email can be re-added", async () => {
    const l = await mk({ email: "jo@acme.test" });
    await db.prisma.suppression.create({
      data: {
        workspaceId: ws,
        kind: "EMAIL",
        value: "jo@acme.test",
        valueHash: sha("jo@acme.test"),
        reason: "MANUAL",
      },
    });
    await updateLead(db.prisma, clock, ws, l.id, { firstName: "Jo" });
    await expect(gdprDeleteLead(db.prisma, clock, other, l.id)).rejects.toMatchObject({
      status: 404,
    });
    await gdprDeleteLead(db.prisma, clock, ws, l.id, null);
    const dump = JSON.stringify([
      await db.prisma.lead.findMany({ where: { workspaceId: ws } }),
      await db.prisma.suppression.findMany({ where: { workspaceId: ws } }),
      await db.prisma.auditLog.findMany({ where: { workspaceId: ws } }),
    ]);
    expect(dump).not.toContain("jo@acme.test");
    const s = await db.prisma.suppression.findFirstOrThrow({
      where: { workspaceId: ws, valueHash: sha("jo@acme.test") },
    });
    expect(s).toMatchObject({ value: null, reason: "MANUAL" }); // an existing suppression keeps its reason
    expect(await isSuppressed(db.prisma, ws, "jo@acme.test")).toBe(true);
    await mk({ email: "jo@acme.test" });
    const g = (await audits("lead.gdpr_delete")).find(
      (a) => (a.meta as { hashes: string[] }).hashes[0] === sha("jo@acme.test"),
    );
    expect(g!.meta).toEqual({ hashes: [sha("jo@acme.test")] });
  });

  test("a new erasure suppression has reason GDPR_ERASURE", async () => {
    const l = await mk({ email: "new@acme.test" });
    await gdprDeleteLead(db.prisma, clock, ws, l.id);
    expect(
      await db.prisma.suppression.findFirstOrThrow({
        where: { workspaceId: ws, valueHash: sha("new@acme.test") },
      }),
    ).toMatchObject({ reason: "GDPR_ERASURE", value: null });
  });

  test("erases soft-deleted duplicates and merged rows (I10)", async () => {
    const dead = await mk({ email: "jo2@acme.test" });
    await softDeleteLead(db.prisma, clock, ws, dead.id);
    const live = await mk({ email: "jo2@acme.test" });
    const old = await mk({ email: "old2@acme.test" });
    await mergeLeads(db.prisma, clock, ws, { keepId: live.id, mergeId: old.id });
    const r = await gdprDeleteLead(db.prisma, clock, ws, live.id);
    expect(r.deleted).toBe(3);
    expect(await db.prisma.lead.count({ where: { id: { in: [dead.id, live.id, old.id] } } })).toBe(
      0,
    );
    const sup = await db.prisma.suppression.findMany({
      where: { workspaceId: ws, valueHash: { in: [sha("jo2@acme.test"), sha("old2@acme.test")] } },
    });
    expect(sup.map((s) => s.value)).toEqual([null, null]);
  });

  test("409 send_in_progress while a send is in flight", async () => {
    const t = (
      await db.prisma.$queryRaw<
        { t: string | null }[]
      >`SELECT to_regclass('"ScheduledMessage"')::text AS t`
    )[0]?.t;
    if (t) return; // real send tables exist (T09+); their own tests cover this
    const run = (sql: string) => db.prisma.$executeRawUnsafe(sql);
    await run(`CREATE TABLE "CampaignLead" (id text, "leadId" text)`);
    await run(`CREATE TABLE "ScheduledMessage" ("campaignLeadId" text, status text)`);
    const l = await mk({ email: "busy@acme.test" });
    await run(`INSERT INTO "CampaignLead" VALUES ('cl1', '${l.id}')`);
    await run(`INSERT INTO "ScheduledMessage" VALUES ('cl1', 'SENDING')`);
    await expect(gdprDeleteLead(db.prisma, clock, ws, l.id)).rejects.toMatchObject({
      status: 409,
      message: "send_in_progress",
    });
    expect(await db.prisma.lead.count({ where: { id: l.id } })).toBe(1);
    await run(`DROP TABLE "ScheduledMessage"`);
    await run(`DROP TABLE "CampaignLead"`);
  });
});

describe("labels", () => {
  test("crud, rename propagates to leads, delete strips it, workspace scoped", async () => {
    const lab = await createLabel(db.prisma, ws, null, { name: "Hot", color: "#ff0000" });
    await expect(
      createLabel(db.prisma, ws, null, { name: "Hot", color: "#00ff00" }),
    ).rejects.toMatchObject({ status: 409 });
    const l = await mk({ labels: ["Hot"] });
    await expect(updateLabel(db.prisma, other, lab.id, { color: "#00ff00" })).rejects.toMatchObject(
      { status: 404 },
    );
    await updateLabel(db.prisma, ws, lab.id, { name: "Warm" });
    expect((await getLead(db.prisma, ws, l.id)).labels).toEqual(["Warm"]);
    expect((await listLabels(db.prisma, other)).length).toBe(0);
    await expect(deleteLabel(db.prisma, other, lab.id)).rejects.toMatchObject({ status: 404 });
    await deleteLabel(db.prisma, ws, lab.id);
    expect((await getLead(db.prisma, ws, l.id)).labels).toEqual([]);
  });
});
