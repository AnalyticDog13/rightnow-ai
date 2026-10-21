import { createTestDb, expectIsolated } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import {
  addBlocklist,
  assertNotSuppressed,
  bulkDeleteBlocklist,
  clearBlocklist,
  exportBlocklistCsv,
  importBlocklistCsv,
  listBlocklist,
  removeBlocklist,
} from "../src/leads/blocklist";
import {
  addToList,
  createList,
  deleteList,
  listLists,
  listStats,
  moveLeads,
  removeFromList,
  renameList,
} from "../src/leads/lists";
import { createLead, gdprDeleteLead, listLeads } from "../src/leads/service";
import { suppressedEmails } from "../src/leads/suppression";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let other: string;
const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));
let n = 0;
const mk = async (w = ws, over: Record<string, unknown> = {}) =>
  (await createLead(db.prisma, w, null, { email: `m${++n}@acme.test`, ...over })).id;
const audits = (action: string, w = ws) =>
  db.prisma.auditLog.findMany({ where: { workspaceId: w, action } });
const blocked = (w: string) => db.prisma.suppression.findMany({ where: { workspaceId: w } });
const csv = async (w: string) => {
  let s = "";
  for await (const c of exportBlocklistCsv(db.prisma, w)) s += c;
  return s;
};
const newWs = async (slug: string) =>
  (await db.prisma.workspace.create({ data: { name: slug, slug } })).id;

beforeAll(async () => {
  db = await createTestDb();
  ws = await newWs("w-lists");
  other = await newWs("o-lists");
});
afterAll(() => db.drop());

describe("lists", () => {
  test("moveLeads puts the lead in the target list only; stats count by verification", async () => {
    const a = await createList(db.prisma, ws, null, "A");
    const b = await createList(db.prisma, ws, null, "B");
    const ids = [await mk(), await mk(), await mk()];
    await db.prisma.lead.updateMany({
      where: { id: { in: ids.slice(0, 2) } },
      data: { verificationStatus: "VERIFIED" },
    });
    await db.prisma.lead.update({
      where: { id: ids[2]! },
      data: { verificationStatus: "INVALID" },
    });
    expect(await addToList(db.prisma, ws, null, a.id, ids)).toEqual({ added: 3 });
    expect(await addToList(db.prisma, ws, null, a.id, ids)).toEqual({ added: 0 });
    expect(await listStats(db.prisma, ws, a.id)).toMatchObject({
      VERIFIED: 2,
      INVALID: 1,
      RISKY: 0,
    });
    await moveLeads(db.prisma, ws, null, { leadIds: [ids[0]!], fromListId: a.id, toListId: b.id });
    const inList = async (id: string) =>
      (await db.prisma.leadListMember.findMany({ where: { leadId: id } })).map((m) => m.listId);
    expect(await inList(ids[0]!)).toEqual([b.id]);
    expect(await inList(ids[1]!)).toEqual([a.id]);
    expect((await listLists(db.prisma, ws)).map((l) => [l.name, l.count])).toEqual([
      ["A", 2],
      ["B", 1],
    ]);
    expect((await listLeads(db.prisma, ws, { listId: b.id })).leads.length).toBe(1);
    expect(await removeFromList(db.prisma, ws, null, a.id, [ids[1]!])).toEqual({ removed: 1 });
  });

  test("deleting a list keeps its leads; duplicate names 409; rename", async () => {
    const l = await createList(db.prisma, ws, null, "Temp");
    await expect(createList(db.prisma, ws, null, "Temp")).rejects.toMatchObject({ status: 409 });
    await createList(db.prisma, other, null, "Temp");
    const ids = [await mk(), await mk(), await mk()];
    await addToList(db.prisma, ws, null, l.id, ids);
    await expect(renameList(db.prisma, ws, null, l.id, "A")).rejects.toMatchObject({
      status: 409,
    });
    expect((await renameList(db.prisma, ws, null, l.id, "Temp2")).name).toBe("Temp2");
    await expect(deleteList(db.prisma, other, null, l.id)).rejects.toMatchObject({ status: 404 });
    await deleteList(db.prisma, ws, null, l.id);
    expect(await db.prisma.lead.count({ where: { id: { in: ids }, deletedAt: null } })).toBe(3);
    expect((await audits("list.delete")).length).toBe(1);
  });

  test("cannot touch another workspace's list or leads", async () => {
    const mine = await createList(db.prisma, ws, null, "Mine");
    const foreign = await mk(other);
    expect(await addToList(db.prisma, ws, null, mine.id, [foreign])).toEqual({ added: 0 });
    const theirs = await createList(db.prisma, other, null, "Theirs");
    await expect(addToList(db.prisma, ws, null, theirs.id, [await mk()])).rejects.toMatchObject({
      status: 404,
    });
    await expect(listStats(db.prisma, ws, theirs.id)).rejects.toMatchObject({ status: 404 });
  });

  test("is workspace scoped", async () => {
    await expectIsolated({
      prisma: db.prisma,
      seed: async (w) => {
        await createList(db.prisma, w, null, "Iso");
      },
      read: (w) => listLists(db.prisma, w),
    });
  });
});

describe("blocklist", () => {
  test("add: kinds, lowercase, invalid, duplicates, audit", async () => {
    const w = await newWs("w-bl-add");
    const r = await addBlocklist(db.prisma, w, null, ["Bad@X.test", "spam.test", "nope"]);
    expect(r).toEqual({ added: 2, duplicates: 0, invalid: 1 });
    expect((await blocked(w)).map((x) => [x.kind, x.value, x.reason, x.source]).sort()).toEqual([
      ["DOMAIN", "spam.test", "MANUAL", "blocklist"],
      ["EMAIL", "bad@x.test", "MANUAL", "blocklist"],
    ]);
    expect(await addBlocklist(db.prisma, w, null, ["bad@x.test", "SPAM.test"])).toMatchObject({
      added: 0,
      duplicates: 2,
    });
    expect((await audits("blocklist.add", w)).length).toBe(2);
    await expect(
      addBlocklist(db.prisma, w, null, Array(1001).fill("a@b.test")),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("suppressed address or domain cannot be enrolled", async () => {
    await addBlocklist(db.prisma, ws, null, ["blocked@ok.test", "evil.test"]);
    const set = await suppressedEmails(db.prisma, ws, [
      "BLOCKED@ok.test",
      "x@evil.test",
      "fine@ok.test",
    ]);
    expect([...set].sort()).toEqual(["blocked@ok.test", "x@evil.test"]);
    await expect(
      assertNotSuppressed(db.prisma, ws, ["fine@ok.test", "x@evil.test"]),
    ).rejects.toMatchObject({ status: 409, message: "suppressed" });
    await assertNotSuppressed(db.prisma, ws, ["fine@ok.test"]);
    expect((await suppressedEmails(db.prisma, other, ["x@evil.test"])).size).toBe(0);
  });

  test("is workspace scoped", async () => {
    await expectIsolated({
      prisma: db.prisma,
      seed: async (w) => {
        await addBlocklist(db.prisma, w, null, ["iso.test"]);
      },
      read: async (w) => (await listBlocklist(db.prisma, w, {})).rows,
    });
  });

  test("a GDPR tombstone lists value null, survives bulk/clear, and needs confirmation by id", async () => {
    const w = await newWs("w-gdpr-bl");
    const lead = await mk(w, { email: "erase@me.test" });
    await gdprDeleteLead(db.prisma, clock, w, lead);
    await addBlocklist(db.prisma, w, null, ["manual@z.test"]);
    await db.prisma.suppression.create({
      data: {
        workspaceId: w,
        kind: "EMAIL",
        value: "unsub@z.test",
        valueHash: "u".repeat(64),
        reason: "UNSUBSCRIBE",
      },
    });
    const list = (await listBlocklist(db.prisma, w, {})).rows;
    const tomb = list.find((r) => r.reason === "GDPR_ERASURE")!;
    expect(tomb.value).toBeNull();
    expect(JSON.stringify(list)).not.toContain("erase@me.test");
    await expect(removeBlocklist(db.prisma, w, null, tomb.id)).rejects.toMatchObject({
      status: 400,
      message: "confirm_required",
    });
    await expect(removeBlocklist(db.prisma, other, null, tomb.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(clearBlocklist(db.prisma, w, null, "nope")).rejects.toMatchObject({
      status: 400,
    });
    expect(await clearBlocklist(db.prisma, w, null, "DELETE ALL")).toEqual({
      deleted: 1,
      kept: 2,
    });
    expect(
      await bulkDeleteBlocklist(
        db.prisma,
        w,
        null,
        list.map((r) => r.id),
      ),
    ).toEqual({ deleted: 0, kept: 2 });
    await removeBlocklist(db.prisma, w, "u1", tomb.id, { confirm: true });
    const rm = (await audits("blocklist.remove", w)).find((a) => a.target === tomb.id)!;
    expect(rm).toMatchObject({ actorId: "u1", target: tomb.id });
    expect(JSON.stringify(rm.meta)).toContain("GDPR_ERASURE");
    expect(JSON.stringify(rm.meta)).not.toContain("erase@me.test");
  });

  test("remove by id is audited; bulk-delete removes plain rows", async () => {
    const w = await newWs("w-rm-bl");
    await addBlocklist(db.prisma, w, null, ["a@r.test", "b@r.test", "c.test"]);
    const [a, b, c] = (await listBlocklist(db.prisma, w, {})).rows;
    await removeBlocklist(db.prisma, w, "admin1", a!.id);
    expect(await bulkDeleteBlocklist(db.prisma, w, "admin1", [b!.id, c!.id])).toEqual({
      deleted: 2,
      kept: 0,
    });
    expect((await blocked(w)).length).toBe(0);
    expect((await audits("blocklist.remove", w)).length).toBe(2);
  });

  test("list filters by reason and attaches the lead of a bounced address", async () => {
    const w = await newWs("w-bounce");
    const id = await mk(w, { email: "gone@bounce.test", firstName: "Gus" });
    await db.prisma.suppression.create({
      data: {
        workspaceId: w,
        kind: "EMAIL",
        value: "gone@bounce.test",
        valueHash: "h".repeat(64),
        reason: "HARD_BOUNCE",
        source: "bounce",
      },
    });
    await addBlocklist(db.prisma, w, null, ["manual@bounce.test"]);
    const r = await listBlocklist(db.prisma, w, { reason: "HARD_BOUNCE" });
    expect(r.total).toBe(1);
    expect(r.rows[0]).toMatchObject({ value: "gone@bounce.test", lead: { id, firstName: "Gus" } });
    expect((await listBlocklist(db.prisma, w, { take: 1 })).nextCursor).not.toBeNull();
  });

  test("export CSV neutralises formulas; import skips junk and reports counts", async () => {
    const w = await newWs("w-exp-bl");
    await db.prisma.suppression.create({
      data: {
        workspaceId: w,
        kind: "DOMAIN",
        value: "=cmd.test",
        valueHash: "e".repeat(64),
        reason: "MANUAL",
      },
    });
    const out = await csv(w);
    expect(out.split("\r\n")[0]).toBe("value,kind,reason,createdAt");
    expect(out).toContain("'=cmd.test,DOMAIN,MANUAL,");
    const r = await importBlocklistCsv(
      db.prisma,
      w,
      "u1",
      Buffer.from("﻿value\r\nA@q.test\r\nq2.test\r\nbad\r\n"),
    );
    expect(r).toEqual({ added: 2, duplicates: 0, invalid: 1 });
    // headerless list: the first row is data
    const r2 = await importBlocklistCsv(db.prisma, w, "u1", Buffer.from("h@q.test\nq3.test\n"));
    expect(r2.added).toBe(2);
    await expect(
      importBlocklistCsv(db.prisma, w, null, Buffer.alloc(6 * 1024 * 1024)),
    ).rejects.toMatchObject({ status: 413 });
    expect((await audits("blocklist.add", w)).length).toBe(2);
  });
});
