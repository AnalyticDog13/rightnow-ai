import { createTestDb, expectIsolated } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { crmActivity } from "../src/crm/activity";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "../src/crm/opportunities";
import { ensureStages } from "../src/crm/stages";
import { createTask, deleteTask, listTasks, updateTask } from "../src/crm/tasks";
import { gdprDeleteLead, mergeLeads } from "../src/leads/service";
import { createNote } from "../src/mail/inbox-library";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

let n = 0;
async function ws(timezone = "UTC") {
  const w = await P().workspace.create({ data: { name: "w", slug: `t${++n}`, timezone } });
  return w.id;
}
const lead = (w: string) =>
  P().lead.create({ data: { workspaceId: w, email: `l${++n}@co${n}.test` } });
const D = (s: string) => new Date(s);
const ids = (r: { id: string }[]) => r.map((x) => x.id).sort();

describe("tasks", () => {
  test("due filters", async () => {
    const w = await ws("Europe/Berlin");
    const now = D("2026-11-05T10:00:00Z");
    const mk = (title: string, dueAt: Date | null, status: "OPEN" | "DONE" = "OPEN") =>
      P().task.create({ data: { workspaceId: w, title, dueAt, status } });
    const over = await mk("over", D("2026-11-04T12:00:00Z"));
    const today = await mk("today", D("2026-11-05T17:00:00Z")); // 18:00 Berlin
    const up = await mk("up", D("2026-11-06T12:00:00Z"));
    await mk("done", D("2026-11-03T12:00:00Z"), "DONE");
    await mk("nodue", null);
    const due = async (d: string, extra = {}) =>
      (await listTasks(P(), w, { due: d, ...extra }, now)).map((t) => t.id);
    expect(await due("overdue")).toEqual([over.id]);
    expect(await due("today")).toEqual([today.id]);
    expect(await due("upcoming")).toEqual([up.id]);
    expect(await due("overdue", { status: "DONE" })).toEqual([]); // DONE is never due
    await expect(listTasks(P(), w, { due: "soon" }, now)).rejects.toThrow();
    // no filter: OPEN only, soonest first, undated last
    expect((await listTasks(P(), w, {}, now)).map((t) => t.title)).toEqual([
      "over",
      "today",
      "up",
      "nodue",
    ]);
    expect((await listTasks(P(), w, { status: "DONE" }, now)).map((t) => t.title)).toEqual([
      "done",
    ]);
  });

  test("complete and reopen", async () => {
    const w = await ws();
    const l = await lead(w);
    const c1 = fixedClock(D("2026-11-05T10:00:00Z"));
    const c2 = fixedClock(D("2026-11-05T11:00:00Z"));
    const t = await createTask(P(), c1, w, "u1", {
      title: " Call back ",
      leadId: l.id,
      dueAt: "2026-11-04T09:00:00Z",
    });
    expect(t).toMatchObject({ title: "Call back", status: "OPEN", lead: { id: l.id } });
    const done = await updateTask(P(), c1, w, "u1", t.id, { status: "DONE" });
    expect(done.completedAt).toEqual(c1.now());
    const audit = await P().auditLog.findMany({
      where: { workspaceId: w, action: "task.update" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toMatchObject({ status: "DONE", leadId: l.id });
    const open = await updateTask(P(), c2, w, "u1", t.id, { status: "OPEN" });
    expect(open.completedAt).toBeNull();

    // AWAITING_APPROVAL (PS-CRM-08): only under its own status until approved
    const a = await P().task.create({
      data: {
        workspaceId: w,
        title: "draft",
        dueAt: D("2026-11-04T00:00:00Z"),
        status: "AWAITING_APPROVAL",
      },
    });
    const now = c2.now();
    const overdue = async () => (await listTasks(P(), w, { due: "overdue" }, now)).map((x) => x.id);
    expect(await overdue()).toEqual([t.id]);
    expect((await listTasks(P(), w, {}, now)).map((x) => x.id)).toEqual([t.id]);
    expect(
      (await listTasks(P(), w, { status: "AWAITING_APPROVAL" }, now)).map((x) => x.id),
    ).toEqual([a.id]);
    await updateTask(P(), c2, w, null, a.id, { status: "OPEN" });
    expect(ids(await listTasks(P(), w, { due: "overdue" }, now))).toEqual([a.id, t.id].sort());

    await deleteTask(P(), w, "u1", a.id);
    expect(await P().task.count({ where: { id: a.id } })).toBe(0);
    await expect(deleteTask(P(), w, "u1", a.id)).rejects.toMatchObject({ status: 404 });
  });

  test("validation and workspace scope", async () => {
    const w = await ws();
    const o = await ws();
    const ol = await lead(o);
    const ostages = await ensureStages(P(), o);
    const oo = await P().opportunity.create({
      data: { workspaceId: o, leadId: ol.id, stageId: ostages[0]!.id, title: "x" },
    });
    const c = fixedClock(D("2026-11-05T10:00:00Z"));
    const mk = (input: unknown) => createTask(P(), c, w, "u1", input);
    await expect(mk({ title: "" })).rejects.toThrow();
    await expect(mk({ title: "x".repeat(201) })).rejects.toThrow();
    await expect(mk({ title: "x", body: "b".repeat(10_001) })).rejects.toThrow();
    await expect(mk({ title: "x", assigneeId: "nobody" })).rejects.toMatchObject({
      status: 400,
      message: "unknown_owner",
    });
    await expect(mk({ title: "x", leadId: ol.id })).rejects.toMatchObject({ status: 404 });
    await expect(mk({ title: "x", opportunityId: oo.id })).rejects.toMatchObject({
      status: 404,
    });
    const mine = await createTask(P(), c, o, "u1", { title: "m" });
    await expect(updateTask(P(), c, w, "u1", mine.id, { title: "z" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(deleteTask(P(), w, "u1", mine.id)).rejects.toMatchObject({ status: 404 });

    // an opportunity task takes the deal's lead; a different lead is refused
    const w2 = await ws();
    const l1 = await lead(w2);
    const l2 = await lead(w2);
    const opp = await createOpportunity(P(), c, w2, "u1", { leadId: l1.id });
    const t = await createTask(P(), c, w2, "u1", { title: "t", opportunityId: opp.id });
    expect(t.leadId).toBe(l1.id);
    await expect(
      createTask(P(), c, w2, "u1", { title: "t", opportunityId: opp.id, leadId: l2.id }),
    ).rejects.toMatchObject({ status: 400 });

    await expectIsolated({
      prisma: P(),
      seed: async (x) => {
        await createTask(P(), c, x, "u1", { title: "s" });
      },
      read: (x) => listTasks(P(), x, {}, c.now()),
    });
  });

  test("activity feed", async () => {
    const w = await ws();
    const l = await lead(w);
    const stages = await ensureStages(P(), w);
    const at = (m: number) => new Date(D("2026-11-05T10:00:00Z").getTime() + m * 60_000);
    await P().note.create({
      data: { workspaceId: w, leadId: l.id, body: "hello", createdAt: at(1) },
    });
    await P().note.create({
      data: {
        workspaceId: w,
        leadId: l.id,
        body: "rang",
        kind: "call",
        createdAt: at(2),
        authorId: "u1",
      },
    });
    await P().event.create({
      data: {
        workspaceId: w,
        type: "REPLY",
        leadId: l.id,
        occurredAt: at(3),
        dedupeKey: "r1",
        meta: { category: "INTERESTED" },
      },
    });
    const opp = await createOpportunity(P(), fixedClock(at(4)), w, "u1", { leadId: l.id });
    const other = await createOpportunity(P(), fixedClock(at(4)), w, "u1", {
      leadId: (await lead(w)).id,
    });
    const contacted = stages.find((s) => s.name === "Contacted")!;
    await updateOpportunity(P(), fixedClock(at(5)), w, "u2", opp.id, { stageId: contacted.id });
    const task = await P().task.create({
      data: { workspaceId: w, leadId: l.id, opportunityId: opp.id, title: "t" },
    });
    await updateTask(P(), fixedClock(at(6)), w, "u2", task.id, { status: "DONE" });
    // unrelated: another lead's note, another deal's stage move
    await P().note.create({
      data: { workspaceId: w, leadId: other.lead.id, body: "x", createdAt: at(7) },
    });
    await updateOpportunity(P(), fixedClock(at(7)), w, "u2", other.id, {
      stageId: contacted.id,
    });

    const all = await crmActivity(P(), w, { leadId: l.id });
    expect(all.items.map((i) => i.kind)).toEqual([
      "task",
      "stage",
      "opportunity",
      "reply",
      "call",
      "note",
    ]);
    expect(all.items[1]).toMatchObject({
      actorId: "u2",
      leadId: l.id,
      opportunityId: opp.id,
      detail: { from: "Not Contacted", to: "Contacted" },
    });
    expect(all.items[4]).toMatchObject({ actorId: "u1", detail: { body: "rang" } });

    // pages of 2 join up without duplicates or gaps
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const pg = await crmActivity(P(), w, { leadId: l.id, take: 2, cursor });
      seen.push(...pg.items.map((i) => i.id));
      cursor = pg.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(all.items.map((i) => i.id));

    // the deal's own feed leaves out the other deal
    const deal = await crmActivity(P(), w, { opportunityId: opp.id });
    expect(deal.items.map((i) => i.kind)).toEqual([
      "task",
      "stage",
      "opportunity",
      "reply",
      "call",
      "note",
    ]);
    // workspace-wide sees both deals
    expect((await crmActivity(P(), w, {})).items.filter((i) => i.kind === "stage")).toHaveLength(2);

    // a deleted deal keeps its history in the lead feed (Rev 2 M10)
    await deleteOpportunity(P(), w, "u1", opp.id);
    const after = await crmActivity(P(), w, { leadId: l.id });
    // the delete audit is stamped with the real clock, far after the fixture's days
    expect(after.items.map((i) => i.kind)).toEqual([
      "task",
      "stage",
      "opportunity",
      "reply",
      "call",
      "note",
      "opportunity",
    ]);
    expect(after.items[6]!.detail).toMatchObject({ action: "opportunity.delete" });
    await expect(crmActivity(P(), w, { cursor: "garbage" })).rejects.toThrow();
  });

  test("cascade and merge", async () => {
    const w = await ws();
    const c = fixedClock(D("2026-11-05T10:00:00Z"));
    const l = await lead(w);
    const keep = await lead(w);
    const gone = await lead(w);
    await createTask(P(), c, w, "u1", { title: "a", leadId: l.id });
    await createTask(P(), c, w, "u1", { title: "b", leadId: gone.id });
    const opp = await createOpportunity(P(), c, w, "u1", { leadId: l.id });
    const ot = await createTask(P(), c, w, "u1", { title: "c", opportunityId: opp.id });
    await deleteOpportunity(P(), w, "u1", opp.id);
    expect(await P().task.findUnique({ where: { id: ot.id } })).toBeNull();
    await mergeLeads(P(), c, w, { keepId: keep.id, mergeId: gone.id }, "u1");
    expect((await listTasks(P(), w, { leadId: keep.id }, c.now())).map((t) => t.title)).toEqual([
      "b",
    ]);
    await gdprDeleteLead(P(), c, w, l.id, "u1");
    expect(await P().task.count({ where: { leadId: l.id } })).toBe(0);
    expect(await P().task.count({ where: { leadId: keep.id } })).toBe(1);
  });

  test("notes carry a kind", async () => {
    const w = await ws();
    const l = await lead(w);
    expect((await createNote(P(), w, "u1", { leadId: l.id, body: "x" })).kind).toBe("note");
    expect((await createNote(P(), w, "u1", { leadId: l.id, body: "x", kind: "sms" })).kind).toBe(
      "sms",
    );
    await expect(
      createNote(P(), w, "u1", { leadId: l.id, body: "x", kind: "fax" }),
    ).rejects.toThrow();
  });
});
