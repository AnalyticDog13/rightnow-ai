import { hostname } from "node:os";
import { PrismaPg } from "@prisma/adapter-pg";
import { systemClock, type Clock } from "@rightnow/core";
import { PrismaClient } from "@rightnow/db/client";
import { PgBoss, type Job, type QueueOptions } from "pg-boss";
import { startHealthServer } from "./health";
import { jobs as defaultJobs } from "./jobs";
import { startHeartbeat } from "./jobs/heartbeat";

export type JobDef = {
  name: string;
  cron?: string;
  options?: QueueOptions;
  handler: (jobs: Job[]) => Promise<void>;
};

// Fixed small pools: the worker needs few connections (boss: polling + maintenance; prisma: heartbeat/boot row/health).
const POOL_MAX = 5;

export async function startWorker(opts: {
  databaseUrl: string;
  jobs?: JobDef[];
  healthPort?: number;
  heartbeatMs?: number;
  clock?: Clock;
}) {
  const clock = opts.clock ?? systemClock;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: opts.databaseUrl, max: POOL_MAX }),
  });
  const boss = new PgBoss({ connectionString: opts.databaseUrl, max: POOL_MAX });
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
      await boss.work(j.name, j.handler);
      if (j.cron) await boss.schedule(j.name, j.cron, {});
    }

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
