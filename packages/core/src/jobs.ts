import type { BackgroundJob, JobStatus, Prisma, PrismaClient } from "@rightnow/db/client";
import { AccountError, isPrismaCode } from "./accounts/service";
import { audit } from "./audit";
import type { Clock } from "./clock";
import { bulkInput, bulkLeads, leadWhere } from "./leads/service";

type Db = PrismaClient | Prisma.TransactionClient;
type Actor = string | null | undefined;
type Handler = (
  prisma: PrismaClient,
  clock: Clock,
  job: BackgroundJob,
  progress: (pct: number) => Promise<void>,
  signal: AbortSignal,
) => Promise<unknown>;

/** R13: a RUNNING job is stale after 5 minutes without progress (every progress() call bumps updatedAt). */
const STALE_MS = 5 * 60_000;
const MAX_RESETS = 3;
const CHUNK = 500;

/** D45: long operations are queued here and answered with 202 {jobId}; the `background-jobs` worker runs them. */
export async function createJob(
  prisma: PrismaClient,
  ws: string,
  actor: Actor,
  kind: string,
  input: unknown,
): Promise<{ jobId: string }> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.backgroundJob.create({
      data: {
        workspaceId: ws,
        kind,
        input: input as Prisma.InputJsonValue,
        createdById: actor ?? null,
      },
    });
    await audit(tx, { workspaceId: ws, actorId: actor }, "job.create", job.id, { kind });
    return { jobId: job.id };
  });
}

export const JOB_HANDLERS: Record<string, Handler> = {
  /** `filter` is walked by id in 500-id chunks, so rows the action itself removes from the filter are not skipped. */
  async leads_bulk(prisma, clock, job, progress, signal) {
    const { filter, action, value } = bulkInput.parse(job.input);
    if (!filter) throw new AccountError(400, "filter_required");
    const where = leadWhere(job.workspaceId, filter);
    const total = await prisma.lead.count({ where });
    let after: string | undefined;
    let done = 0;
    let affected = 0;
    while (!signal.aborted) {
      const rows = await prisma.lead.findMany({
        where: { AND: [where, ...(after ? [{ id: { gt: after } }] : [])] },
        select: { id: true },
        orderBy: { id: "asc" },
        take: CHUNK,
      });
      if (!rows.length) break;
      const ids = rows.map((r) => r.id);
      affected += (
        await bulkLeads(prisma, clock, job.workspaceId, { ids, action, value }, job.createdById)
      ).affected;
      after = ids[ids.length - 1];
      done += ids.length;
      await progress(Math.min(100, Math.floor((done * 100) / total)));
    }
    return { affected };
  },
};

/** Resets stale RUNNING jobs to PENDING (attempts + 1); the third reset fails the job, as `lead-import` does. */
export async function resetStaleJobs(prisma: PrismaClient, clock: Clock) {
  const now = clock.now();
  const stale = {
    status: "RUNNING" as const,
    updatedAt: { lt: new Date(now.getTime() - STALE_MS) },
  };
  await prisma.backgroundJob.updateMany({
    where: { ...stale, attempts: { gte: MAX_RESETS - 1 } },
    data: { status: "FAILED", error: "worker_stopped_repeatedly", finishedAt: now },
  });
  await prisma.backgroundJob.updateMany({
    where: stale,
    data: { status: "PENDING", attempts: { increment: 1 } },
  });
}

/** Oldest PENDING job of a workspace with no RUNNING job. SKIP LOCKED plus the one-RUNNING-per-workspace unique index. */
async function claim(prisma: PrismaClient, clock: Clock) {
  try {
    return await prisma.$transaction(async (tx) => {
      const [c] = await tx.$queryRaw<{ id: string }[]>`
        SELECT j.id FROM "BackgroundJob" j
        WHERE j.status = 'PENDING' AND NOT EXISTS (
          SELECT 1 FROM "BackgroundJob" r WHERE r."workspaceId" = j."workspaceId" AND r.status = 'RUNNING')
        ORDER BY j."createdAt", j.id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!c) return null;
      const r = await tx.backgroundJob.updateMany({
        where: { id: c.id, status: "PENDING" },
        data: { status: "RUNNING", updatedAt: clock.now() },
      });
      return r.count ? tx.backgroundJob.findUniqueOrThrow({ where: { id: c.id } }) : null;
    });
  } catch (e) {
    if (isPrismaCode(e, "P2002")) return null; // another worker started a job of this workspace first
    throw e;
  }
}

/** Runs the next claimable job; returns its id, or null when nothing was claimable. */
export async function runNextJob(
  prisma: PrismaClient,
  clock: Clock,
  signal: AbortSignal,
): Promise<string | null> {
  await resetStaleJobs(prisma, clock);
  const job = await claim(prisma, clock);
  if (!job) return null;
  const end = (data: Prisma.BackgroundJobUpdateManyMutationInput) =>
    prisma.backgroundJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: { ...data, finishedAt: clock.now() },
    });
  const handler = JOB_HANDLERS[job.kind];
  if (!handler) {
    await end({ status: "FAILED", error: "unknown_kind" });
    return job.id;
  }
  try {
    const result = await handler(
      prisma,
      clock,
      job,
      async (pct) => {
        await prisma.backgroundJob.updateMany({
          where: { id: job.id, status: "RUNNING" },
          data: { progress: pct, updatedAt: clock.now() },
        });
      },
      signal,
    );
    if (!signal.aborted) await end({ status: "DONE", progress: 100, result: result as never });
  } catch (e) {
    // on shutdown the job stays RUNNING: the stale reset requeues it
    if (signal.aborted) return job.id;
    if (!(e instanceof AccountError)) console.error("background job failed", job.id, e);
    await end({ status: "FAILED", error: e instanceof AccountError ? e.message : "job_failed" });
  }
  return job.id;
}

export async function getJob(db: Db, ws: string, id: string) {
  const job = await db.backgroundJob.findFirst({ where: { id, workspaceId: ws } });
  if (!job) throw new AccountError(404, "Not found");
  return job;
}

export async function listJobs(
  db: Db,
  ws: string,
  q: { cursor?: string; take?: number; status?: JobStatus },
) {
  const take = Math.min(q.take ?? 50, 100);
  const rows = await db.backgroundJob.findMany({
    where: { workspaceId: ws, ...(q.status && { status: q.status }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor && { cursor: { id: q.cursor } }),
  });
  const next = rows.length > take ? rows.pop()! : null;
  return { jobs: rows, nextCursor: next?.id ?? null };
}
