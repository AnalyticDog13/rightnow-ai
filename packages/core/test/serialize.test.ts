import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { encryptCredentials } from "../src/accounts/credentials";
import { toApiAccount } from "../src/accounts/serialize";
import { seedAccount, testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  testEnv();
  db = await createTestDb();
});
afterAll(() => db.drop());

test("toApiAccount never exposes credentials, cursor or lease", async () => {
  const enc = encryptCredentials({
    kind: "smtp",
    imap: { host: "imap.x", port: 993, secure: true, username: "u", password: "imap-secret-pw" },
    smtp: { host: "smtp.x", port: 465, secure: true, username: "u", password: "smtp-secret-pw" },
  });
  const a = await seedAccount(db.prisma, enc);
  const full = await db.prisma.emailAccount.update({
    where: { id: a.id },
    data: {
      syncCursor: { kind: "fake", epoch: 1, seq: 2 },
      refreshLeaseId: "lease-x",
      refreshLeaseUntil: new Date(),
    },
  });
  const json = JSON.stringify(toApiAccount(full));
  for (const s of [
    "credentialsEnc",
    "syncCursor",
    "refreshLease",
    "credentialGen",
    enc,
    "secret-pw",
    "lease-x",
    "password",
  ])
    expect(json).not.toContain(s);
  expect(JSON.parse(json)).toMatchObject({ id: a.id, email: "a@example.com", status: "CONNECTED" });
});
