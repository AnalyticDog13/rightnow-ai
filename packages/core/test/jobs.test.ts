import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fixedClock } from "../src/clock";
import { createJob, getJob, JOB_HANDLERS, resetStaleJobs, runNextJob } from "../src/jobs";
import { purgeRetention } from "../src/retention";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
const signal = new AbortController().signal;
let n = 0;
const ws = async () =>
  (await P().workspace.create({ data: { name: "W", slug: `w-job-${n++}` } })).id;
const leads = (workspaceId: string, count: number, tags: string[]) =>
  P().lead.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      workspaceId,
      email: `l${i}-${tags[0]}@acme.test`,
      tags,
    })),
  });
const row = (id: string) => P().backgroundJob.findUniqueOrThrow({ where: { id } });
const running = (workspaceId: string, over: { updatedAt?: Date; attempts?: number } = {}) =>
  P().backgroundJob.create({
    data: { workspaceId, kind: "leads_bulk", input: {}, status: "RUNNING", updatedAt: T, ...over },
  });
const tagAll = { filter: {}, action: "add_tags", value: ["q"] };

test("leads_bulk over 1200 filtered leads: 3 chunks, progress 41, 83, 100, DONE {affected:1200}", async () => {
  const w = await ws();
  await leads(w, 1200, ["x"]);
  await leads(w, 5, ["other"]);
  const { jobId } = await createJob(P(), w, "u1", "leads_bulk", {
    filter: { tag: "x" },
    action: "add_tags",
    value: ["y"],
  });
  expect(await row(jobId)).toMatchObject({ status: "PENDING", progress: 0, createdById: "u1" });
  expect(await P().auditLog.count({ where: { workspaceId: w, action: "job.create" } })).toBe(1);

  const seen: number[] = [];
  const orig = JOB_HANDLERS.leads_bulk!;
  const spy = vi
    .spyOn(JOB_HANDLERS, "leads_bulk")
    .mockImplementation((p, c, j, progress, s) =>
      orig(p, c, j, async (pct) => (seen.push(pct), progress(pct)), s),
    );
  expect(await runNextJob(P(), fixedClock(T), signal)).toBe(jobId);
  spy.mockRestore();

  expect(seen).toEqual([41, 83, 100]);
  expect(await row(jobId)).toMatchObject({
    status: "DONE",
    progress: 100,
    result: { affected: 1200 },
    error: null,
  });
  expect(await P().lead.count({ where: { workspaceId: w, tags: { has: "y" } } })).toBe(1200);
  expect(await P().auditLog.count({ where: { workspaceId: w, action: "lead.bulk" } })).toBe(3);
  expect(await runNextJob(P(), fixedClock(T), signal)).toBeNull();
});

test("an unknown kind fails with unknown_kind", async () => {
  const w = await ws();
  const { jobId } = await createJob(P(), w, null, "nope", {});
  expect(await runNextJob(P(), fixedClock(T), signal)).toBe(jobId);
  expect(await row(jobId)).toMatchObject({ status: "FAILED", error: "unknown_kind" });
});

test("a stale RUNNING job (5 min without progress) returns to PENDING, then FAILED on the third reset", async () => {
  const w = await ws();
  const fresh = await running(w, { updatedAt: new Date(T.getTime() - 4 * MIN) });
  await resetStaleJobs(P(), fixedClock(T));
  expect(await row(fresh.id)).toMatchObject({ status: "RUNNING", attempts: 0 });
  await P().backgroundJob.delete({ where: { id: fresh.id } });

  const stale = await running(w, { updatedAt: new Date(T.getTime() - 6 * MIN) });
  for (const attempts of [1, 2]) {
    await resetStaleJobs(P(), fixedClock(T));
    expect(await row(stale.id)).toMatchObject({ status: "PENDING", attempts });
    await P().backgroundJob.update({
      where: { id: stale.id },
      data: { status: "RUNNING", updatedAt: new Date(T.getTime() - 6 * MIN) },
    });
  }
  await resetStaleJobs(P(), fixedClock(T));
  const dead = await row(stale.id);
  expect(dead).toMatchObject({ status: "FAILED", attempts: 2, error: "worker_stopped_repeatedly" });
  expect(dead.finishedAt).toEqual(T);
});

test("R13: a job reporting progress every 10 s for 40 min is never reset", async () => {
  const w = await ws();
  const clock = fixedClock(T);
  const { jobId } = await createJob(P(), w, null, "slow", {});
  const checked: string[] = [];
  JOB_HANDLERS.slow = async (p, c, _job, progress) => {
    for (let i = 1; i <= 240; i++) {
      clock.advance(10_000);
      await progress(Math.floor(i / 2.4));
      await resetStaleJobs(p, c);
      if (i % 80 === 0) checked.push((await row(jobId)).status);
    }
    return { ok: true };
  };
  await runNextJob(P(), clock, signal);
  delete JOB_HANDLERS.slow;
  expect(checked).toEqual(["RUNNING", "RUNNING", "RUNNING"]);
  expect(await row(jobId)).toMatchObject({ status: "DONE", attempts: 0, result: { ok: true } });
});

test("R13: one RUNNING job per workspace; another workspace's job still runs", async () => {
  const a = await ws();
  const b = await ws();
  await leads(b, 3, ["x"]);
  const long = await running(a, { updatedAt: new Date(T.getTime() - MIN) });
  await createJob(P(), a, null, "leads_bulk", tagAll);
  const { jobId: mine } = await createJob(P(), b, null, "leads_bulk", tagAll);
  expect(await runNextJob(P(), fixedClock(T), signal)).toBe(mine);
  expect(await row(mine)).toMatchObject({ status: "DONE", result: { affected: 3 } });
  expect(await runNextJob(P(), fixedClock(T), signal)).toBeNull(); // A's second job waits
  expect((await row(long.id)).status).toBe("RUNNING");
});

test("concurrent claims never run the same job twice", async () => {
  const w = await ws();
  const { jobId } = await createJob(P(), w, null, "leads_bulk", {
    ...tagAll,
    filter: { tag: "none" },
  });
  const got = await Promise.all([1, 2, 3].map(() => runNextJob(P(), fixedClock(T), signal)));
  expect(got.filter(Boolean)).toEqual([jobId]);
});

test("a job of workspace A is a 404 for B", async () => {
  const a = await ws();
  const b = await ws();
  const { jobId } = await createJob(P(), a, null, "nope", {});
  await expect(getJob(P(), b, jobId)).rejects.toMatchObject({ status: 404 });
  expect((await getJob(P(), a, jobId)).id).toBe(jobId);
});

test("R13 retention: AutomationRun and finished BackgroundJob rows are purged after 90 days", async () => {
  const w = await ws();
  const rule = await P().automationRule.create({
    data: { workspaceId: w, name: "r", trigger: "REPLY", actions: [], position: 0 },
  });
  for (const [eventId, age] of [
    ["e91", 91],
    ["e89", 89],
  ] as const)
    await P().automationRun.create({
      data: {
        workspaceId: w,
        ruleId: rule.id,
        eventId,
        status: "OK",
        createdAt: new Date(T.getTime() - age * DAY),
      },
    });
  const old = new Date(T.getTime() - 91 * DAY);
  const mk = (status: "DONE" | "FAILED" | "RUNNING", createdAt: Date) =>
    P().backgroundJob.create({
      data: { workspaceId: w, kind: "k", input: {}, status, createdAt, updatedAt: createdAt },
    });
  await mk("DONE", old);
  await mk("FAILED", old);
  const kept = [await mk("RUNNING", old), await mk("DONE", new Date(T.getTime() - 89 * DAY))];
  const r = await purgeRetention(P(), fixedClock(T));
  expect(r).toMatchObject({ automationRuns: 1, backgroundJobs: 2 });
  const runs = await P().automationRun.findMany({ where: { workspaceId: w } });
  expect(runs.map((x) => x.eventId)).toEqual(["e89"]);
  const left = await P().backgroundJob.findMany({ where: { workspaceId: w } });
  expect(left.map((j) => j.id).sort()).toEqual(kept.map((j) => j.id).sort());
});
