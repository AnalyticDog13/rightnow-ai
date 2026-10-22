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
  // allowlist: a column added later (here a fake one) stays private by default
  const json = JSON.stringify(
    toApiAccount({ ...full, futureSecret: "future-secret" } as typeof full, {
      sent: 0,
      reserved: 0,
    }),
  );
  for (const s of [
    "credentialsEnc",
    "syncCursor",
    "refreshLease",
    "credentialGen",
    enc,
    "secret-pw",
    "lease-x",
    "password",
    "future-secret",
  ])
    expect(json).not.toContain(s);
  expect(JSON.parse(json)).toMatchObject({ id: a.id, email: "a@example.com", status: "CONNECTED" });
});

test("sync block: state, lag, errors and import progress, without the cursor, page token or lease", async () => {
  const a = await seedAccount(db.prisma, "x", "sync@example.com");
  const now = new Date("2026-10-20T10:00:00Z");
  const full = await db.prisma.emailAccount.update({
    where: { id: a.id },
    data: {
      syncState: "SYNCING",
      lastSyncCompletedAt: new Date(now.getTime() - 90_000),
      syncErrors: 2,
      syncLeaseId: "sync-lease-x",
      syncProgress: {
        mode: "HISTORICAL",
        folder: "INBOX",
        pageToken: "page-token-x",
        since: "2026-09-20T10:00:00.000Z",
        cursor: { kind: "fake", epoch: 1, seq: 2 },
        startedAt: now.toISOString(),
        fetched: 40,
      },
      lastError: { kind: "SYNC", code: "TransientBeforeSendError" },
    },
  });
  const v = toApiAccount(full, { sent: 0, reserved: 0 }, now);
  expect(v.sync).toEqual({
    state: "SYNCING",
    lastCompletedAt: full.lastSyncCompletedAt,
    lagSec: 90,
    errors: 2,
    progress: {
      mode: "HISTORICAL",
      folder: "INBOX",
      fetched: 40,
      since: "2026-09-20T10:00:00.000Z",
    },
    lastError: { kind: "SYNC", code: "TransientBeforeSendError" },
  });
  expect(v.displayStatus).toBe("CONNECTION_ERROR");
  const json = JSON.stringify(v);
  for (const s of ["page-token-x", "sync-lease-x", "epoch", "syncLease", "syncProgress"])
    expect(json).not.toContain(s);
});
