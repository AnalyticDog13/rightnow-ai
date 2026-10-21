import { hostname } from "node:os";
import { systemClock, type Clock } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db/client";
import { createPrisma } from "@rightnow/db/create";
import { PgBoss, type Job, type Queue } from "pg-boss";
import { startHealthServer } from "./health";
import { jobs as defaultJobs } from "./jobs";
import { startHeartbeat } from "./jobs/heartbeat";

export type JobDef = {
  name: string;
  cron?: string;
  /** Also sent once right after registration, so a (re)started worker does not wait for the first cron tick. */
  boot?: boolean;
  options?: Omit<Queue, "name">;
  handler: (jobs: Job[], deps: JobDeps) => Promise<void>;
};

export type JobDeps = { prisma: PrismaClient; clock: Clock; bootId: string };

export async function startWorker(opts: {
  databaseUrl: string;
  jobs?: JobDef[];
  healthPort?: number;
  heartbeatMs?: number;
  clock?: Clock;
  /** Pool size for both Prisma and pg-boss (env DB_POOL_MAX). */
  poolMax?: number;
}) {
  const clock = opts.clock ?? systemClock;
  const max = opts.poolMax ?? 5;
  const prisma = createPrisma(opts.databaseUrl, max);
  const boss = new PgBoss({
    connectionString: opts.databaseUrl,
    max,
    // heartbeat failures are checked per queue on the monitor interval
    superviseIntervalSeconds: 15,
    monitorIntervalSeconds: 15,
  });
  boss.on("error", (e) => console.error("pg-boss error", e));
  let started = false;
  let bootId: string | undefined;
  let health: Awaited<ReturnType<typeof startHealthServer>> | undefined;
  let stopHeartbeat: (() => Promise<void>) | undefined;

  // Idempotent; releases whatever was acquired, always stamps stoppedAt, throws the first error.
  let tearing: Promise<void> | undefined;
  const teardown = () =>
    (tearing ??= (async () => {
      const errors: unknown[] = [];
      const step = async (f?: () => Promise<unknown>) => {
        try {
          await f?.();
        } catch (e) {
          errors.push(e);
        }
      };
      started = false;
      await step(stopHeartbeat);
      await step(() => boss.stop({ graceful: true }));
      await step(health?.close);
      if (bootId) {
        await step(() =>
          prisma.workerBoot.update({ where: { id: bootId }, data: { stoppedAt: clock.now() } }),
        );
      }
      await step(() => prisma.$disconnect());
      if (errors.length) throw errors[0];
    })());

  try {
    await boss.start();
    started = true;
    bootId = (await prisma.workerBoot.create({ data: { hostname: hostname() } })).id;

    for (const j of opts.jobs ?? defaultJobs) {
      await boss.createQueue(j.name, j.options);
      await boss.work<object>(j.name, (js) => j.handler(js, { prisma, clock, bootId: bootId! }));
      if (j.cron) await boss.schedule(j.name, j.cron, {});
    }
    for (const j of opts.jobs ?? defaultJobs) if (j.boot) await boss.send(j.name, {});

    health = await startHealthServer(opts.healthPort ?? 8081, async () => {
      if (!started) return false;
      await prisma.$queryRaw`select 1`;
      return true;
    });
    stopHeartbeat = startHeartbeat(prisma, bootId, clock, opts.heartbeatMs);
  } catch (e) {
    await teardown().catch((te) => console.error("cleanup after failed start", te));
    throw e;
  }

  return { bootId, boss, healthPort: health.port, stop: teardown };
}
