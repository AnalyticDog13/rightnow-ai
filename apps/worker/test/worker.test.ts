import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { startWorker, type JobDef } from "../src/boss";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

test("runs a job, serves /healthz, and stamps stoppedAt on stop", async () => {
  const got: unknown[] = [];
  const demo: JobDef = {
    name: "demo",
    handler: async (jobs) => {
      got.push(...jobs.map((j) => j.data));
    },
  };
  const w = await startWorker({ databaseUrl: db.url, jobs: [demo], healthPort: 0 });

  const res = await fetch(`http://127.0.0.1:${w.healthPort}/healthz`);
  expect(res.status).toBe(200);

  await w.boss.send("demo", { hello: "world" });
  await expect.poll(() => got, { timeout: 5000 }).toEqual([{ hello: "world" }]);

  const before = await db.prisma.workerBoot.findUniqueOrThrow({ where: { id: w.bootId } });
  expect(before.stoppedAt).toBeNull();

  await w.stop();
  const after = await db.prisma.workerBoot.findUniqueOrThrow({ where: { id: w.bootId } });
  expect(after.stoppedAt).not.toBeNull();
  await expect(fetch(`http://127.0.0.1:${w.healthPort}/healthz`)).rejects.toThrow();
});
