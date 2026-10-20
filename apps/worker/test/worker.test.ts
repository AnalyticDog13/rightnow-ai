import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { startWorker, type JobDef } from "../src/boss";
import { startHealthServer } from "../src/health";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

test("runs a job, serves /healthz, and stamps stoppedAt on stop", async () => {
  const got: unknown[] = [];
  const stamp = new Date("2031-02-03T00:00:00Z");
  const demo: JobDef = {
    name: "demo",
    handler: async (jobs, { prisma, clock }) => {
      // Handlers get the worker's own prisma and injected clock.
      await prisma.$queryRaw`select 1`;
      got.push(...jobs.map((j) => j.data), clock.now());
    },
  };
  const w = await startWorker({
    databaseUrl: db.url,
    jobs: [demo],
    healthPort: 0,
    clock: { now: () => stamp },
  });

  const res = await fetch(`http://127.0.0.1:${w.healthPort}/healthz`);
  expect(res.status).toBe(200);

  await w.boss.send("demo", { hello: "world" });
  await expect.poll(() => got, { timeout: 5000 }).toEqual([{ hello: "world" }, stamp]);

  const before = await db.prisma.workerBoot.findUniqueOrThrow({ where: { id: w.bootId } });
  expect(before.stoppedAt).toBeNull();

  await w.stop();
  const after = await db.prisma.workerBoot.findUniqueOrThrow({ where: { id: w.bootId } });
  expect(after.stoppedAt).not.toBeNull();
  await expect(fetch(`http://127.0.0.1:${w.healthPort}/healthz`)).rejects.toThrow();
});

test("heartbeat updates lastHeartbeatAt using the injected clock", async () => {
  const stamp = new Date("2030-01-01T00:00:00Z");
  const w = await startWorker({
    databaseUrl: db.url,
    jobs: [],
    healthPort: 0,
    heartbeatMs: 50,
    clock: { now: () => stamp },
  });
  const read = () => db.prisma.workerBoot.findUniqueOrThrow({ where: { id: w.bootId } });
  await expect.poll(async () => (await read()).lastHeartbeatAt, { timeout: 5000 }).toEqual(stamp);
  await w.stop();
  await w.stop(); // idempotent
  expect((await read()).stoppedAt).toEqual(stamp);
});

test("startup failure (health port in use) cleans up and stamps stoppedAt", async () => {
  const blocker = await startHealthServer(0, async () => true);
  const before = await db.prisma.workerBoot.count();
  await expect(
    startWorker({ databaseUrl: db.url, jobs: [], healthPort: blocker.port }),
  ).rejects.toMatchObject({ code: "EADDRINUSE" });
  const rows = await db.prisma.workerBoot.findMany({ where: { stoppedAt: null } });
  expect(await db.prisma.workerBoot.count()).toBe(before + 1);
  expect(rows).toHaveLength(0);
  await blocker.close();
});

test("/healthz is 503 when the check fails or throws", async () => {
  for (const check of [async () => false, async () => Promise.reject(new Error("db down"))]) {
    const h = await startHealthServer(0, check);
    expect((await fetch(`http://127.0.0.1:${h.port}/healthz`)).status).toBe(503);
    await h.close();
  }
});
