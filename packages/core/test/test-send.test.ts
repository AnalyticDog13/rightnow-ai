import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "@rightnow/db/test-db";
import {
  FakeProvider,
  PermanentSendError,
  RateLimitedError,
  getFakeProvider,
  type MailProvider,
} from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { encryptCredentials } from "../src/accounts/credentials";
import { sendTestEmail } from "../src/accounts/test-send";
import { liveVerify, recordVerification } from "../src/accounts/live-verify";
import { fixedClock } from "../src/clock";
import { resetEnvCache } from "../src/env";
import { testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let n = 0;
const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));
const creds = () =>
  encryptCredentials({
    kind: "oauth",
    accessToken: "a",
    refreshToken: "r",
    expiresAt: 1,
    scope: "s",
  });

beforeAll(async () => {
  testEnv();
  process.env.MAIL_PROVIDER_FAKE = "1";
  process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "rn-ts-"));
  resetEnvCache();
  db = await createTestDb();
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w-ts" } })).id;
});
afterAll(() => db.drop());

const mk = () =>
  db.prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "GMAIL",
      email: `ts${++n}@acme.io`,
      fromName: "Sam Sender",
      firstName: "Sam",
      lastName: "S",
      replyTo: "reply@acme.io",
      signature: "-- Sam",
      capTier: "GMAIL_WORKSPACE",
      providerCap: 1500,
      credentialsEnc: creds(),
    },
  });
const send = (accountId: string, over: Record<string, unknown> = {}, w = ws) =>
  sendTestEmail(
    db.prisma,
    clock,
    {},
    {
      workspaceId: w,
      actorId: "u1",
      accountId,
      to: "Bob@Dest.Example",
      confirmAuthorized: true,
      ...over,
    },
  );

describe("sendTestEmail", () => {
  test("confirmAuthorized false is 400 and sends nothing", async () => {
    const a = await mk();
    await expect(send(a.id, { confirmAuthorized: false })).rejects.toMatchObject({ status: 400 });
    expect(
      (await getFakeProvider(a.email).listMessages({ since: new Date(0), folder: "SENT" }))
        .messages,
    ).toHaveLength(0);
  });

  test("sends a marked message, touches no usage, audits the domain only", async () => {
    const a = await mk();
    const r = await send(a.id);
    const [m] = (
      await getFakeProvider(a.email).listMessages({ since: new Date(0), folder: "SENT" })
    ).messages;
    expect(m!.headers["x-rightnow-test"]).toEqual(["1"]);
    expect(m!.rfcMessageId).toBe(r.rfcMessageId);
    expect(m!.from).toEqual({ email: a.email, name: "Sam Sender" });
    expect(m!.headers["reply-to"]![0]).toContain("reply@acme.io");
    expect(m!.text).toContain("-- Sam");
    expect(await db.prisma.accountDailyUsage.count({ where: { accountId: a.id } })).toBe(0);
    expect(await db.prisma.workspaceDailyUsage.count({ where: { workspaceId: ws } })).toBe(0);
    const log = await db.prisma.auditLog.findMany({
      where: { target: a.id, action: "account.test_send" },
    });
    expect(log).toHaveLength(1);
    expect(JSON.stringify(log[0]!.meta)).toContain("dest.example");
    expect(JSON.stringify(log[0])).not.toContain("bob");
  });

  test("the 6th send within 10 minutes is 429; later it works again", async () => {
    const a = await mk();
    for (let i = 0; i < 5; i++) await send(a.id);
    await expect(send(a.id)).rejects.toMatchObject({ status: 429 });
    clock.advance(11 * 60_000);
    await expect(send(a.id)).resolves.toBeTruthy();
  });

  test("AuthError records the error and answers 409 needs_attention", async () => {
    const a = await mk();
    getFakeProvider(a.email).failNext("auth_revoked");
    await expect(send(a.id)).rejects.toMatchObject({ status: 409, message: "needs_attention" });
    expect(await db.prisma.emailAccount.findUnique({ where: { id: a.id } })).toMatchObject({
      lifecycle: "NEEDS_ATTENTION",
    });
  });

  test("an ambiguous send is 502 outcome_unknown with the Message-ID, never retried", async () => {
    const a = await mk();
    getFakeProvider(a.email).failNext("timeout_after_write");
    const e = await send(a.id).catch((x) => x);
    expect(e).toMatchObject({ status: 502, message: "outcome_unknown" });
    expect(e.body.rfcMessageId).toMatch(/^<.+@.+>$/);
    expect(
      (await getFakeProvider(a.email).listMessages({ since: new Date(0), folder: "SENT" }))
        .messages,
    ).toHaveLength(1);
  });

  test("RateLimitedError(30) is 429 with retryAfterSec", async () => {
    const a = await mk();
    const providerFor = (): MailProvider =>
      ({
        address: a.email,
        send: async () => {
          throw new RateLimitedError(30);
        },
      }) as unknown as MailProvider;
    const e = await sendTestEmail(
      db.prisma,
      clock,
      { providerFor },
      {
        workspaceId: ws,
        actorId: "u1",
        accountId: a.id,
        to: "b@d.example",
        confirmAuthorized: true,
      },
    ).catch((x) => x);
    expect(e).toMatchObject({ status: 429, body: { retryAfterSec: 30 } });
  });

  test("a foreign workspace gets 404", async () => {
    const a = await mk();
    await expect(send(a.id, {}, "ws_other")).rejects.toMatchObject({ status: 404 });
  });
});

describe("liveVerify", () => {
  test("every step passes against the Fake", async () => {
    const p = new FakeProvider(`lv${++n}@acme.io`);
    const r = await liveVerify(p, "me@dest.example", clock);
    expect(r.map((s) => s.step)).toEqual([
      "diagnostics",
      "send",
      "findSent",
      "locate",
      "cursor",
      "changes",
    ]);
    expect(r.filter((s) => !s.ok)).toEqual([]);
    expect(r.find((s) => s.step === "findSent")!.detail).toBe("Message-ID kept");
  });

  test("findSent fails when the provider rewrote our Message-ID", async () => {
    const p = new FakeProvider(`lv${++n}@acme.io`);
    const find = p.findSent.bind(p);
    p.findSent = async (id: string) => {
      const m = await find(id);
      return m && { ...m, rfcMessageId: "<rewritten@provider.test>" };
    };
    const r = await liveVerify(p, "me@dest.example", clock);
    expect(r.find((s) => s.step === "findSent")).toMatchObject({
      ok: false,
      detail: "Message-ID rewritten to <rewritten@provider.test>",
    });
  });

  test("recordVerification: an all-PASS run records the provider (D17), any FAIL removes it", async () => {
    const a = await mk();
    const p = new FakeProvider(`lv${++n}@acme.io`); // stands in for a real provider
    const steps = await liveVerify(p, "me@dest.example", clock);
    expect(await recordVerification(db.prisma, "GMAIL", a.id, steps)).toBe("recorded");
    expect(
      await db.prisma.providerVerification.findUnique({ where: { provider: "GMAIL" } }),
    ).toMatchObject({
      accountId: a.id,
      report: JSON.parse(JSON.stringify(steps)), // undefined details are dropped in JSON
    });
    const failed = [...steps, { step: "changes", ok: false, detail: "timeout" }];
    expect(await recordVerification(db.prisma, "GMAIL", a.id, failed)).toBe("removed");
    expect(await db.prisma.providerVerification.count()).toBe(0);
    expect(await recordVerification(db.prisma, "SMTP", a.id, failed)).toBe("removed"); // nothing to remove
  });

  test("a failing send stops the run", async () => {
    const p = new FakeProvider(`lv${++n}@acme.io`);
    p.failNext("auth_revoked");
    const r = await liveVerify(p, "me@dest.example", clock);
    expect(r.find((s) => s.step === "send")!.ok).toBe(false);
    expect(r.map((s) => s.step)).toEqual(["diagnostics", "send"]);
  });
});

describe("concurrency and the live script", () => {
  test("10 parallel sends: exactly 5 go out, 5 are 429", async () => {
    const a = await mk();
    clock.advance(60 * 60_000);
    const r = await Promise.allSettled(Array.from({ length: 10 }, () => send(a.id)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(5);
    expect(
      r.filter((x) => x.status === "rejected" && (x.reason as { status: number }).status === 429),
    ).toHaveLength(5);
    expect(
      (await getFakeProvider(a.email).listMessages({ since: new Date(0), folder: "SENT" }))
        .messages,
    ).toHaveLength(5);
  });

  test("a recipient-level rejection does not touch account health", async () => {
    const a = await mk();
    const providerFor = (): MailProvider =>
      ({
        address: a.email,
        send: async () => {
          throw new PermanentSendError("smtp_550");
        },
      }) as unknown as MailProvider;
    await expect(
      sendTestEmail(
        db.prisma,
        clock,
        { providerFor },
        {
          workspaceId: ws,
          actorId: "u1",
          accountId: a.id,
          to: "x@d.example",
          confirmAuthorized: true,
        },
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(await db.prisma.emailAccount.findUnique({ where: { id: a.id } })).toMatchObject({
      errorCount24h: 0,
      lastError: null,
    });
  });

  test("scripts/live-verify.ts refuses to run against the Fake", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(__dirname, "../../../scripts/live-verify.ts"),
        "--account",
        "x",
        "--to",
        "a@b.co",
      ],
      { env: { ...process.env, MAIL_PROVIDER_FAKE: "1" }, encoding: "utf8" },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("MAIL_PROVIDER_FAKE");
  });
});
