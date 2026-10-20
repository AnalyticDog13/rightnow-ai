import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "@rightnow/db/test-db";
import { ImapSmtpProvider } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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

describe("createProvider for SMTP accounts", () => {
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
        { id: a.id, provider: "SMTP", email: "ann2@example.test", appendToSent: false },
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
