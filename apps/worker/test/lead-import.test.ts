import { createImport, fixedClock } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { leadImport, leadImportJob } from "../src/jobs/lead-import";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
const T0 = new Date("2026-10-20T10:00:00Z");
const clock = fixedClock(T0);
const mk = (email: string) =>
  createImport(db.prisma, ws, null, {
    fileName: "f.csv",
    data: Buffer.from(`email\n${email}\n`),
    mapping: ["email"],
    options: {},
    confirmedAuthorized: true,
    lawfulBasis: "consent",
  });
const get = (id: string) => db.prisma.importJob.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  db = await createTestDb();
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w-imp-job" } })).id;
});
afterAll(() => db.drop());

describe("lead-import job", () => {
  test("is registered every minute with a stately queue and a heartbeat (gate M-9)", () => {
    expect(leadImportJob).toMatchObject({
      name: "lead-import",
      cron: "* * * * *",
      options: {
        policy: "stately",
        retryLimit: 0,
        heartbeatSeconds: 10,
        expireInSeconds: 3 * 3600,
      },
    });
  });

  test("picks the oldest PENDING job and completes it", async () => {
    const a = await mk("first@job.test");
    const b = await mk("second@job.test");
    await leadImport(db.prisma, clock);
    expect((await get(a.importJobId)).status).toBe("DONE");
    expect((await get(b.importJobId)).status).toBe("PENDING");
    await leadImport(db.prisma, clock);
    expect((await get(b.importJobId)).status).toBe("DONE");
  });

  test("a job RUNNING for 31 minutes goes back to PENDING and the next run completes it", async () => {
    const { importJobId } = await mk("stale@job.test");
    await db.prisma.importJob.update({
      where: { id: importJobId },
      data: { status: "RUNNING", updatedAt: new Date(T0.getTime() - 31 * 60_000) },
    });
    await leadImport(db.prisma, clock); // resets and runs in one pass
    expect((await get(importJobId)).status).toBe("DONE");
    expect(
      await db.prisma.lead.count({ where: { workspaceId: ws, email: "stale@job.test" } }),
    ).toBe(1);
  });

  test("a RUNNING job touched 5 minutes ago is left alone", async () => {
    const { importJobId } = await mk("busy@job.test");
    await db.prisma.importJob.update({
      where: { id: importJobId },
      data: { status: "RUNNING", updatedAt: new Date(T0.getTime() - 5 * 60_000) },
    });
    await leadImport(db.prisma, clock);
    expect((await get(importJobId)).status).toBe("RUNNING");
  });
});

describe("lead-import crash loop", () => {
  const stale = (id: string, attempts: number) =>
    db.prisma.importJob
      .update({ where: { id }, data: { status: "RUNNING", attempts } })
      .then(
        () =>
          db.prisma
            .$executeRaw`UPDATE "ImportJob" SET "updatedAt" = ${new Date(T0.getTime() - 31 * 60_000)} WHERE id = ${id}`,
      );

  test("each stale reset counts an attempt", async () => {
    const { importJobId } = await mk("loop1@job.test");
    await stale(importJobId, 1);
    await leadImport(db.prisma, clock);
    expect(await get(importJobId)).toMatchObject({ status: "DONE", attempts: 2 });
  });

  test("a job that went stale three times is FAILED with its error, data cleared, and not run again", async () => {
    const { importJobId } = await mk("loop2@job.test");
    await stale(importJobId, 2);
    await leadImport(db.prisma, clock);
    const j = await get(importJobId);
    expect(j).toMatchObject({ status: "FAILED", data: null });
    expect(j.error).toContain("repeatedly");
    expect(
      await db.prisma.lead.count({ where: { workspaceId: ws, email: "loop2@job.test" } }),
    ).toBe(0);
  });
});
