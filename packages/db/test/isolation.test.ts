import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDb, expectIsolated } from "@rightnow/db/test-db";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const seed = (workspaceId: string) => db.prisma.auditLog.create({ data: { workspaceId, action: "x" } });

test("expectIsolated passes for a workspace-scoped read", async () => {
  await expectIsolated({
    prisma: db.prisma,
    seed,
    read: (workspaceId) => db.prisma.auditLog.findMany({ where: { workspaceId } }),
  });
});

test("expectIsolated fails for an unscoped read", async () => {
  await expect(
    expectIsolated({ prisma: db.prisma, seed, read: () => db.prisma.auditLog.findMany() }),
  ).rejects.toThrow();
});
