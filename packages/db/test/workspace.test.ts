import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

test("creates a workspace and reads it by slug", async () => {
  await db.prisma.workspace.create({ data: { name: "Acme", slug: "acme" } });
  const found = await db.prisma.workspace.findUnique({ where: { slug: "acme" } });
  expect(found?.name).toBe("Acme");
});

test("duplicate slug rejects with P2002", async () => {
  await db.prisma.workspace.create({ data: { name: "A", slug: "dup" } });
  await expect(db.prisma.workspace.create({ data: { name: "B", slug: "dup" } })).rejects.toMatchObject({
    code: "P2002",
  });
});

test("two test databases are isolated", async () => {
  const other = await createTestDb();
  try {
    await db.prisma.workspace.create({ data: { name: "Only here", slug: "only-here" } });
    expect(await other.prisma.workspace.findUnique({ where: { slug: "only-here" } })).toBeNull();
  } finally {
    await other.drop();
  }
});
