import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "@rightnow/db/test-db";
import { ImapSmtpProvider } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { decryptCredentials, encryptCredentials } from "../src/accounts/credentials";
import { createProvider } from "../src/accounts/factory";
import { AccountError } from "../src/accounts/service";
import { connectSmtpAccount, testSmtpConnection } from "../src/accounts/smtp-connect";
import { systemClock } from "../src/clock";
import { resetEnvCache } from "../src/env";
import { seedAccount, testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
beforeAll(async () => {
  testEnv();
  process.env.MAIL_PROVIDER_FAKE = "1";
  process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "rn-smtp-"));
  resetEnvCache();
  db = await createTestDb();
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w-smtp" } })).id;
});
afterAll(async () => {
  delete process.env.MAIL_PROVIDER_FAKE;
  resetEnvCache();
  await db.drop();
});

const server = (host: string) => ({
  host,
  port: 993,
  secure: true,
  username: "ann@example.test",
  password: "hunter2-secret",
});
const input = (o: Record<string, unknown> = {}) => ({
  email: "Ann@Example.test",
  firstName: "Ann",
  lastName: "Lee",
  imap: server("imap.example.test"),
  smtp: { ...server("smtp.example.test"), port: 465 },
  ...o,
});
const connect = (i: unknown, actor = "u1") =>
  connectSmtpAccount(db.prisma, systemClock, {}, ws, actor, i);

describe("connectSmtpAccount", () => {
  test("a passing check saves one SMTP row; the password is only inside credentialsEnc", async () => {
    const r = await connect(input());
    expect(r.account).toMatchObject({
      email: "ann@example.test",
      provider: "SMTP",
      capTier: "SMTP",
      providerCap: 100,
      dailyLimit: 30,
      status: "CONNECTED",
      appendToSent: true,
      fromName: "Ann Lee",
    });
    const rows = await db.prisma.emailAccount.findMany({ where: { workspaceId: ws } });
    expect(rows).toHaveLength(1);
    expect(decryptCredentials(rows[0]!.credentialsEnc!)).toMatchObject({
      kind: "smtp",
      imap: { password: "hunter2-secret", host: "imap.example.test" },
      smtp: { password: "hunter2-secret", port: 465 },
    });
    const everything = JSON.stringify([
      { ...rows[0], credentialsEnc: undefined },
      r,
      await db.prisma.auditLog.findMany({ where: { workspaceId: ws } }),
    ]);
    expect(everything).not.toContain("hunter2");
    const log = await db.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: ws, action: "account.connect" },
    });
    expect(log).toMatchObject({ actorId: "u1", target: rows[0]!.id });
  });

  test("smtp.gmail.com and smtp.office365.com default appendToSent to false", async () => {
    const r = await connect(input({ email: "g@example.test", smtp: server("smtp.gmail.com") }));
    expect(r.account.appendToSent).toBe(false);
  });

  test("providerCap above the SMTP maximum is clamped and reported", async () => {
    const r = await connect(input({ email: "cap@example.test", providerCap: 50_000 }));
    expect(r.account.providerCap).toBe(10_000);
    expect(r.warnings).toEqual([
      expect.objectContaining({ field: "providerCap", clampedTo: 10_000 }),
    ]);
    expect(r.account.dailyLimit).toBe(30);
  });

  test("a failing host answers 422 with the checks and saves nothing", async () => {
    const before = await db.prisma.emailAccount.count();
    const e = await connect(
      input({
        email: "bad@example.test",
        imap: server("fail.example.test"),
        smtp: server("fail.example.test"),
      }),
    ).catch((x) => x);
    expect(e).toBeInstanceOf(AccountError);
    expect(e.status).toBe(422);
    expect(e.body.ok).toBe(false);
    expect(e.body.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true);
    expect(JSON.stringify(e.body)).not.toContain("hunter2");
    expect(await db.prisma.emailAccount.count()).toBe(before);
  });

  test("a mailbox that is already connected answers account_exists", async () => {
    const e = await connect(input()).catch((x) => x);
    expect(e).toBeInstanceOf(AccountError);
    expect(e.status).toBe(409);
    expect(e.message).toBe("account_exists");
  });

  test("a deleted account is revived with its id and the new credentials", async () => {
    const first = await connect(input({ email: "back@example.test" }));
    await db.prisma.emailAccount.update({
      where: { id: first.account.id },
      data: { deletedAt: new Date() },
    });
    const again = await connect(input({ email: "back@example.test" }));
    expect(again.account.id).toBe(first.account.id);
    expect(again.account.deletedAt).toBeNull();
  });

  test("a Gmail account deleted and revived as SMTP keeps no stale sync state; limits follow one rule", async () => {
    const g = await db.prisma.emailAccount.create({
      data: {
        workspaceId: ws,
        provider: "GMAIL",
        email: "mover@example.test",
        fromName: "Old",
        firstName: "Old",
        lastName: "Name",
        capTier: "GMAIL_WORKSPACE",
        providerCap: 1500,
        dailyLimit: 400,
        minGapSec: 20,
        syncCursor: { kind: "gmail", historyId: "999" },
        syncState: "FAILED",
        lastSyncCompletedAt: new Date(),
        lastError: { kind: "CONNECTION", code: "invalid_grant", message: "x" },
        errorCount24h: 4,
        lifecycle: "NEEDS_ATTENTION",
        deletedAt: new Date(),
      },
    });
    const r = await connect(input({ email: "mover@example.test" }));
    expect(r.account.id).toBe(g.id);
    const row = await db.prisma.emailAccount.findUniqueOrThrow({ where: { id: g.id } });
    expect(row).toMatchObject({
      provider: "SMTP",
      capTier: "SMTP",
      providerCap: 100,
      syncCursor: null,
      syncState: "IDLE",
      lastSyncCompletedAt: null,
      lastError: null,
      errorCount24h: 0,
      lifecycle: "ACTIVE",
      firstName: "Ann",
      // the earlier choices survive, clamped to the new tier: 400 -> floor(100 / 2); the gap keeps the higher value
      dailyLimit: 50,
      minGapSec: 20,
    });
    // and a smaller earlier limit is kept as is
    await db.prisma.emailAccount.update({
      where: { id: g.id },
      data: { deletedAt: new Date(), dailyLimit: 12 },
    });
    await connect(input({ email: "mover@example.test" }));
    expect(
      (await db.prisma.emailAccount.findUniqueOrThrow({ where: { id: g.id } })).dailyLimit,
    ).toBe(12);
  });

  test("invalid input is rejected before any check runs", async () => {
    await expect(connect(input({ imap: { ...server("x.test"), port: 0 } }))).rejects.toThrow();
    await expect(connect(input({ email: "nope" }))).rejects.toThrow();
    await expect(connect(input({ imap: { ...server("a b/c"), port: 993 } }))).rejects.toThrow();
    await expect(connect({ ...input(), extra: 1 })).rejects.toThrow();
  });
});

describe("testSmtpConnection", () => {
  test("runs the checks and saves nothing", async () => {
    const before = await db.prisma.emailAccount.count();
    const ok = await testSmtpConnection({}, input({ email: "t@example.test" }));
    expect(ok.ok).toBe(true);
    const bad = await testSmtpConnection({}, input({ imap: server("fail.example.test") }));
    expect(bad.ok).toBe(false);
    expect(await db.prisma.emailAccount.count()).toBe(before);
  });

  test("diagnostic responses are clipped to 200 characters", async () => {
    const d = await testSmtpConnection(
      {
        providerFor: () =>
          ({
            diagnostics: async () => ({
              ok: false,
              checks: [{ name: "smtp_auth", ok: false, code: "x", response: "r".repeat(500) }],
            }),
          }) as never,
      },
      input(),
    );
    expect(d.checks[0]!.response).toHaveLength(200);
  });
});

describe("secrets in test-connection", () => {
  test("a real failing AUTH that echoes the password leaves it out of the response, logs and errors", async () => {
    const PW = "Echo-me-9f3k-secret";
    const { SMTPServer } = await import("smtp-server");
    const smtp = new SMTPServer({
      authOptional: false,
      allowInsecureAuth: true,
      logger: false,
      onAuth: (a, _s, cb) =>
        cb(Object.assign(new Error(`535 5.7.8 rejected ${a.password}`), { responseCode: 535 })),
    });
    await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
    delete process.env.MAIL_PROVIDER_FAKE;
    resetEnvCache();
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    try {
      const closed = { ...server("127.0.0.1"), port: 1, secure: false, password: PW };
      const bad = { ...closed, port: (smtp.server.address() as { port: number }).port };
      const d = await testSmtpConnection({}, input({ imap: closed, smtp: bad }));
      const c = d.checks.find((k) => k.name === "smtp_auth")!;
      expect(c).toMatchObject({ ok: false, code: "bad_credentials" });
      expect(JSON.stringify([d, logs.map((l) => l.mock.calls)])).not.toContain(PW);
      const e = await connect(input({ imap: closed, smtp: bad })).catch((x) => x);
      expect(e.status).toBe(422);
      expect(JSON.stringify([e.body, e.message, e.stack])).not.toContain(PW);
    } finally {
      vi.restoreAllMocks();
      smtp.close();
      process.env.MAIL_PROVIDER_FAKE = "1";
      resetEnvCache();
    }
  });
});

describe("createProvider for SMTP accounts", () => {
  test("only reads credentials of its own workspace", async () => {
    delete process.env.MAIL_PROVIDER_FAKE;
    resetEnvCache();
    try {
      const closed = { ...server("127.0.0.1"), port: 1, secure: false };
      const a = await seedAccount(
        db.prisma,
        encryptCredentials({ kind: "smtp", imap: closed, smtp: closed }),
        "iso@example.test",
      );
      const other = await db.prisma.workspace.create({ data: { name: "O", slug: "o-iso" } });
      const p = createProvider(
        { id: a.id, workspaceId: other.id, provider: "SMTP", email: "iso@example.test" },
        { prisma: db.prisma },
      );
      await expect(p.diagnostics()).rejects.toThrow(/no credentials/);
    } finally {
      process.env.MAIL_PROVIDER_FAKE = "1";
      resetEnvCache();
    }
  });

  test("builds an ImapSmtpProvider that reads the stored credentials and never leaks the password", async () => {
    delete process.env.MAIL_PROVIDER_FAKE;
    resetEnvCache();
    try {
      const closed = { ...server("127.0.0.1"), port: 1, secure: false };
      const a = await seedAccount(
        db.prisma,
        encryptCredentials({ kind: "smtp", imap: closed, smtp: closed }),
        "ann2@example.test",
      );
      const p = createProvider(
        {
          id: a.id,
          workspaceId: a.workspaceId,
          provider: "SMTP",
          email: "ann2@example.test",
          appendToSent: false,
        },
        { prisma: db.prisma },
      );
      expect(p).toBeInstanceOf(ImapSmtpProvider);
      const d = await p.diagnostics();
      expect(d.ok).toBe(false);
      expect(d.checks.find((c) => c.name === "imap_login")?.code).toBe("connection_refused");
      expect(JSON.stringify(d)).not.toContain("hunter2");
    } finally {
      process.env.MAIL_PROVIDER_FAKE = "1";
      resetEnvCache();
    }
  });
});
