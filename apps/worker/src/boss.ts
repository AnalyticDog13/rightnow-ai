import { hostname } from "node:os";
import { PrismaPg } from "@prisma/adapter-pg";
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
}) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: opts.databaseUrl, max: POOL_MAX }),
  });
  const boss = new PgBoss({ connectionString: opts.databaseUrl, max: POOL_MAX });
  boss.on("error", (e) => console.error("pg-boss error", e));
  let started = false;

  await boss.start();
  started = true;
  const { id: bootId } = await prisma.workerBoot.create({ data: { hostname: hostname() } });

  for (const j of opts.jobs ?? defaultJobs) {
    await boss.createQueue(j.name, j.options);
    await boss.work(j.name, j.handler);
    if (j.cron) await boss.schedule(j.name, j.cron, {});
  }

  const health = await startHealthServer(opts.healthPort ?? 8081, async () => {
    if (!started) return false;
    await prisma.$queryRaw`select 1`;
    return true;
  });
  const stopHeartbeat = startHeartbeat(prisma, bootId);

  return {
    bootId,
    boss,
    healthPort: health.port,
    async stop() {
      stopHeartbeat();
      started = false;
      await boss.stop({ graceful: true });
      await health.close();
      await prisma.workerBoot.update({ where: { id: bootId }, data: { stoppedAt: new Date() } });
      await prisma.$disconnect();
    },
  };
}
