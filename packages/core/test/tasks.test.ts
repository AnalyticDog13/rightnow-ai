import { createTestDb, expectIsolated } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { crmActivity, leadFamily } from "../src/crm/activity";
import { createOpportunity, deleteOpportunity, updateOpportunity } from "../src/crm/opportunities";
import { ensureStages } from "../src/crm/stages";
import { createTask, deleteTask, listTasks, updateTask } from "../src/crm/tasks";
import { gdprDeleteLead, mergeLeads, softDeleteLead } from "../src/leads/service";
import { leadTimeline } from "../src/leads/timeline";
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
    ).rejects.toMatchObject({ status: 400, message: "lead_mismatch" });

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
    await deleteOpportunity(P(), w, "u1", opp.id, fixedClock(at(8)));
    const after = await crmActivity(P(), w, { leadId: l.id });
    expect(after.items.map((i) => i.kind)).toEqual([
      "opportunity",
      "task",
      "stage",
      "opportunity",
      "reply",
      "call",
      "note",
    ]);
    expect(after.items[0]!.detail).toMatchObject({ action: "opportunity.delete" });
    // the deleted deal's own feed still answers (lead taken from its audit rows); unknown and foreign ids give an empty feed
    const gone = await crmActivity(P(), w, { opportunityId: opp.id });
    expect(gone.items.map((i) => i.kind)).toEqual(after.items.map((i) => i.kind));
    expect((await crmActivity(P(), w, { opportunityId: "nope" })).items).toEqual([]);
    const o = await ws();
    const ol = await lead(o);
    const os = await ensureStages(P(), o);
    const oo = await P().opportunity.create({
      data: { workspaceId: o, leadId: ol.id, stageId: os[0]!.id, title: "x" },
    });
    await deleteOpportunity(P(), o, "u1", oo.id, fixedClock(at(9)));
    expect((await crmActivity(P(), w, { opportunityId: oo.id })).items).toEqual([]);
    await expect(crmActivity(P(), w, { cursor: "garbage" })).rejects.toThrow();
  });

  test("merged leads keep their CRM history in the kept lead's feed and timeline", async () => {
    const w = await ws();
    const c = fixedClock(D("2026-11-05T10:00:00Z"));
    const [a, b, k] = [await lead(w), await lead(w), await lead(w)];
    const opp = await createOpportunity(P(), c, w, "u1", { leadId: a.id });
    const task = await createTask(P(), c, w, "u1", { title: "t", leadId: a.id });
    await updateTask(P(), c, w, "u1", task.id, { status: "DONE" });
    const kinds = async (id: string) =>
      (await crmActivity(P(), w, { leadId: id })).items.map((i) => i.kind).sort();
    const before = await kinds(a.id);
    expect(before).toEqual(["opportunity", "task", "task"]);
    await mergeLeads(P(), c, w, { keepId: b.id, mergeId: a.id }, "u1");
    expect(await kinds(b.id)).toEqual(before);
    await mergeLeads(P(), c, w, { keepId: k.id, mergeId: b.id }, "u1"); // chained: a into b into k
    expect(await kinds(k.id)).toEqual(before);
    expect(await kinds(await lead(w).then((x) => x.id))).toEqual([]);
    const tl = await leadTimeline(P(), w, k.id);
    expect(tl.filter((e) => e.kind === "opportunity")).toHaveLength(1);
    expect((await crmActivity(P(), w, { opportunityId: opp.id })).items).toHaveLength(1);
  });

  test("today and overdue follow the local day across DST changes", async () => {
    const w = await ws("America/New_York");
    const mk = (iso: string) =>
      P().task.create({ data: { workspaceId: w, title: iso, dueAt: D(iso) } });
    const bucket = async (now: string) => {
      const r: Record<string, string[]> = {};
      for (const due of ["overdue", "today", "upcoming"])
        r[due] = (await listTasks(P(), w, { due }, D(now))).map((t) => t.title);
      return r;
    };
    // spring forward 2026-03-08: a 23 hour day, 05:00Z to 04:00Z
    for (const iso of [
      "2026-03-08T04:59:00Z",
      "2026-03-08T05:00:00Z",
      "2026-03-09T03:59:00Z",
      "2026-03-09T04:00:00Z",
    ])
      await mk(iso);
    expect(await bucket("2026-03-08T15:00:00Z")).toEqual({
      overdue: ["2026-03-08T04:59:00Z"],
      today: ["2026-03-08T05:00:00Z", "2026-03-09T03:59:00Z"],
      upcoming: ["2026-03-09T04:00:00Z"],
    });
    // fall back 2026-11-01: a 25 hour day, 04:00Z to 05:00Z next day
    for (const iso of [
      "2026-11-01T03:59:00Z",
      "2026-11-01T04:00:00Z",
      "2026-11-02T04:59:00Z",
      "2026-11-02T05:00:00Z",
    ])
      await mk(iso);
    const fall = await bucket("2026-11-01T12:00:00Z");
    expect(fall.overdue).toContain("2026-11-01T03:59:00Z");
    expect(fall.today).toEqual(["2026-11-01T04:00:00Z", "2026-11-02T04:59:00Z"]);
    expect(fall.upcoming).toEqual(["2026-11-02T05:00:00Z"]);
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

  test("a soft-deleted lead takes no task and its tasks are not listed; lead-less tasks stay", async () => {
    const w = await ws();
    const c = fixedClock(D("2026-11-05T10:00:00Z"));
    const l = await lead(w);
    const opp = await createOpportunity(P(), c, w, "u1", { leadId: l.id });
    await createTask(P(), c, w, "u1", {
      title: "lead",
      leadId: l.id,
      dueAt: "2026-11-04T09:00:00Z",
    });
    await createTask(P(), c, w, "u1", { title: "free", dueAt: "2026-11-04T09:00:00Z" });
    await softDeleteLead(P(), c, w, l.id);
    await expect(createTask(P(), c, w, "u1", { title: "x", leadId: l.id })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      createTask(P(), c, w, "u1", { title: "x", opportunityId: opp.id }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await listTasks(P(), w, {}, c.now())).map((t) => t.title)).toEqual(["free"]);
    expect((await listTasks(P(), w, { due: "overdue" }, c.now())).map((t) => t.title)).toEqual([
      "free",
    ]);
  });

  test("leadFamily follows merge chains, within the workspace", async () => {
    const w = await ws();
    const c = fixedClock(D("2026-11-05T10:00:00Z"));
    const [a, b, k, x] = [await lead(w), await lead(w), await lead(w), await lead(w)];
    await mergeLeads(P(), c, w, { keepId: b.id, mergeId: a.id }, "u1");
    await mergeLeads(P(), c, w, { keepId: k.id, mergeId: b.id }, "u1");
    expect((await leadFamily(P(), w, k.id)).sort()).toEqual([a.id, b.id, k.id].sort());
    expect((await leadFamily(P(), w, b.id)).sort()).toEqual([a.id, b.id].sort());
    expect(await leadFamily(P(), w, x.id)).toEqual([x.id]);
    expect(await leadFamily(P(), await ws(), k.id)).toEqual([]);
  });

  test("the activity feed names each item's deal", async () => {
    const w = await ws();
    const c = fixedClock(D("2026-11-05T10:00:00Z"));
    const l = await lead(w);
    const opp = await createOpportunity(P(), c, w, "u1", { leadId: l.id, title: "Big deal" });
    await createTask(P(), c, w, "u1", { title: "t", opportunityId: opp.id });
    const { items } = await crmActivity(P(), w, {});
    expect(items.map((i) => i.opportunityTitle)).toEqual(["Big deal", "Big deal"]);
    await deleteOpportunity(P(), w, "u1", opp.id);
    const after = await crmActivity(P(), w, {});
    expect(
      after.items.find((i) => i.detail.action === "opportunity.delete")!.opportunityTitle,
    ).toBeNull();
  });
});
