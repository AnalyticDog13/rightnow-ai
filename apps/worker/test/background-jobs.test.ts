import { createJob, fixedClock } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { jobs } from "../src/jobs";
import { backgroundJobs, backgroundJobsJob } from "../src/jobs/background-jobs";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

test("background-jobs: every minute, stately, with a heartbeat (R2) and a 3 h expiry (M3), registered", () => {
  expect(backgroundJobsJob).toMatchObject({
    name: "background-jobs",
    cron: "* * * * *",
    // a 500-lead ai_personalize at 30 calls/min is ~17 min, past pg-boss's 15-min default
    options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10, expireInSeconds: 3 * 3600 },
  });
  expect(jobs).toContain(backgroundJobsJob);
});

test("one tick drains two workspaces' jobs and returns once idle time runs out", async () => {
  const P = db.prisma;
  const ids: string[] = [];
  for (const s of ["a", "b"]) {
    const ws = (await P.workspace.create({ data: { name: s, slug: `bj-${s}` } })).id;
    await P.lead.create({ data: { workspaceId: ws, email: `x@${s}.test`, tags: ["x"] } });
    ids.push(
      (
        await createJob(P, ws, null, "leads_bulk", {
          filter: { tag: "x" },
          action: "add_tags",
          value: ["y"],
        })
      ).jobId,
    );
  }
  const t0 = Date.now();
  expect(await backgroundJobs(P, fixedClock(new Date()), { maxMs: 400 })).toBe(2);
  expect(Date.now() - t0).toBeLessThan(3_000);
  const rows = await P.backgroundJob.findMany({ where: { id: { in: ids } } });
  expect(rows.map((r) => [r.status, r.result])).toEqual([
    ["DONE", { affected: 1 }],
    ["DONE", { affected: 1 }],
  ]);
});
