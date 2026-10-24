import { randomBytes } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { systemClock } from "../src/clock";
import { resetEnvCache } from "../src/env";
import { seedMigrationFixture, verifyMigrationFixture } from "../src/migration-check";
import { testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  testEnv();
  db = await createTestDb();
});
afterAll(() => db.drop());

test("seed then verify passes; seeding twice duplicates nothing", async () => {
  await seedMigrationFixture(db.prisma, systemClock);
  await seedMigrationFixture(db.prisma, systemClock);
  await verifyMigrationFixture(db.prisma);
  expect(await db.prisma.workspace.count({ where: { slug: "migration-check" } })).toBe(1);
  expect(await db.prisma.emailAccount.count()).toBe(1);
  expect(await db.prisma.attachment.count()).toBe(1);
});

test("the account is one no worker job contacts a provider for", async () => {
  const a = await db.prisma.emailAccount.findFirstOrThrow();
  expect(a.lifecycle).toBe("NEEDS_ATTENTION");
  expect(a.status).toBe("ERROR");
});

test("a different key is rejected without leaking the credentials", async () => {
  const e = await verifyMigrationFixture(db.prisma, randomBytes(32)).catch((x: Error) => x);
  expect(e).toBeInstanceOf(Error);
  expect((e as Error).message).toMatch(/do not decrypt with this ENCRYPTION_KEY/);
  expect((e as Error).message).not.toContain("mig-access");
});

test("missing ENCRYPTION_KEY is an env error, not a decrypt failure", async () => {
  const saved = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  resetEnvCache();
  try {
    const e = await verifyMigrationFixture(db.prisma).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).not.toMatch(/do not decrypt/);
  } finally {
    process.env.ENCRYPTION_KEY = saved;
    resetEnvCache();
  }
});

test("a flipped attachment byte is a checksum error", async () => {
  const att = await db.prisma.attachment.findFirstOrThrow();
  const data = Buffer.from(att.data!);
  data[0] = data[0]! ^ 0xff;
  await db.prisma.attachment.update({ where: { id: att.id }, data: { data } });
  await expect(verifyMigrationFixture(db.prisma)).rejects.toThrow(/checksum/);
});
