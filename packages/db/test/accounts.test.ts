import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDb, expectIsolated } from "@rightnow/db/test-db";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
beforeAll(async () => {
  db = await createTestDb();
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w" } })).id;
});
afterAll(async () => {
  await db.drop();
});

const account = (workspaceId: string, email: string) =>
  db.prisma.emailAccount.create({
    data: {
      workspaceId,
      provider: "SMTP",
      email,
      fromName: "A",
      firstName: "A",
      lastName: "B",
      capTier: "SMTP",
      providerCap: 100,
    },
  });

test("same email in a different case is rejected in one workspace", async () => {
  await account(ws, "dup@example.com");
  await expect(account(ws, "DUP@example.com")).rejects.toMatchObject({ code: "P2002" });
});

test("address is free again after soft delete", async () => {
  const a = await account(ws, "gone@example.com");
  await db.prisma.emailAccount.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
  await expect(account(ws, "gone@example.com")).resolves.toBeTruthy();
});

test("same address is allowed in another workspace", async () => {
  await account(ws, "shared@example.com");
  await expectIsolated({
    prisma: db.prisma,
    seed: (w) => account(w, "shared@example.com"),
    read: (w) => db.prisma.emailAccount.findMany({ where: { workspaceId: w } }),
  });
});

test("nextSendAt defaults to now", async () => {
  const before = Date.now();
  const a = await account(ws, "fresh@example.com");
  expect(a.nextSendAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  expect(a.nextSendAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  expect(a.credentialGen).toBe(0);
});
