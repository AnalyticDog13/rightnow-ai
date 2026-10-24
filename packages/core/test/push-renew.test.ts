import { createHash } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import {
  AuthError,
  PushError,
  TransientBeforeSendError,
  type MailProvider,
} from "@rightnow/providers";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { encryptCredentials } from "../src/accounts/credentials";
import { disconnectAccount, getAccount } from "../src/accounts/service";
import { fixedClock } from "../src/clock";
import { resetEnvCache } from "../src/env";
import { renewPush, type PushEnv } from "../src/push/renew";
import { testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
const T0 = new Date("2026-11-01T10:00:00Z");
const HOUR = 3_600_000;
const clock = fixedClock(T0);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const vps: PushEnv = {
  MODE: "vps",
  APP_URL: "https://app.rn.test",
  GMAIL_PUBSUB_TOPIC: "projects/p/topics/t",
  GMAIL_PUSH_SA_EMAIL: "push@p.iam.gserviceaccount.com",
};

type Stub = {
  subscribe: ReturnType<typeof vi.fn>;
  renew: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
};
let n = 0;
let stubs: Map<string, Stub>;
let providerCalls: string[];
const stubFor = (id: string): Stub => {
  if (!stubs.has(id))
    stubs.set(id, {
      subscribe: vi.fn(async () => ({
        externalId: `ext-${++n}`,
        expiresAt: new Date(clock.now().getTime() + 7 * 24 * HOUR),
      })),
      renew: vi.fn(async () => ({ expiresAt: new Date(clock.now().getTime() + 7 * 24 * HOUR) })),
      unsubscribe: vi.fn(async () => {}),
    });
  return stubs.get(id)!;
};
const deps = (env: PushEnv = vps) => ({
  env,
  providerFor: async (a: { id: string }) => {
    providerCalls.push(a.id);
    return { kind: "GMAIL", ...stubFor(a.id) } as unknown as MailProvider;
  },
});

async function mk(provider: "GMAIL" | "MICROSOFT" | "SMTP", over: Record<string, unknown> = {}) {
  return db.prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider,
      email: `u${++n}@acme.io`,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: provider === "GMAIL" ? "GMAIL_WORKSPACE" : provider === "SMTP" ? "SMTP" : "MS365",
      providerCap: 1000,
      credentialsEnc: encryptCredentials({
        kind: "oauth",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: 1,
        scope: "s",
      }),
      ...over,
    },
  });
}
/** Holds a subscribe until both concurrent runs are inside it (or 3 s), so the race is not timing luck. */
const bothStarted = async (s: Stub) => {
  for (let i = 0; i < 300 && s.subscribe.mock.calls.length < 2; i++)
    await new Promise((r) => setTimeout(r, 10));
};
const rows = () => db.prisma.pushSubscription.findMany({ orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  testEnv();
  db = await createTestDb();
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w-push" } })).id;
});
afterAll(() => db.drop());
beforeEach(async () => {
  stubs = new Map();
  providerCalls = [];
  await db.prisma.pushSubscription.deleteMany();
  await db.prisma.emailAccount.deleteMany();
  clock.advance(0);
});

describe("renewPush", () => {
  test("vps with env: a GMAIL and a MICROSOFT account get ACTIVE rows; IMAP never; clientState only as a hash", async () => {
    const g = await mk("GMAIL");
    const m = await mk("MICROSOFT");
    const s = await mk("SMTP");
    expect(await renewPush(db.prisma, clock, deps())).toEqual({
      created: 2,
      renewed: 0,
      failed: 0,
    });
    const r = await rows();
    expect(r.map((x) => x.status)).toEqual(["ACTIVE", "ACTIVE"]);
    // the raw insert keeps the instant (no timezone shift)
    expect(r.every((x) => x.expiresAt.getTime() === T0.getTime() + 7 * 24 * HOUR)).toBe(true);
    expect(providerCalls).not.toContain(s.id);
    expect(stubs.has(s.id)).toBe(false);

    expect(stubFor(g.id).subscribe).toHaveBeenCalledWith({
      notificationUrl: "https://app.rn.test/api/push/gmail",
      topicName: "projects/p/topics/t",
    });
    const call = stubFor(m.id).subscribe.mock.calls[0]![0] as {
      notificationUrl: string;
      clientState: string;
    };
    expect(call.notificationUrl).toBe("https://app.rn.test/api/push/graph");
    expect(Buffer.from(call.clientState, "base64url")).toHaveLength(32);
    const gm = r.find((x) => x.accountId === m.id)!;
    expect(gm.clientStateHash).toBe(sha(call.clientState));
    expect(r.find((x) => x.accountId === g.id)!.clientStateHash).toBeNull();
    // the plaintext is stored nowhere
    expect(JSON.stringify(r)).not.toContain(call.clientState);
  });

  test("renews a subscription expiring in 23 h, leaves one expiring in 48 h", async () => {
    const a = await mk("MICROSOFT");
    const b = await mk("MICROSOFT");
    await renewPush(db.prisma, clock, deps());
    await db.prisma.pushSubscription.update({
      where: { accountId: a.id },
      data: { expiresAt: new Date(T0.getTime() + 23 * HOUR) },
    });
    await db.prisma.pushSubscription.update({
      where: { accountId: b.id },
      data: { expiresAt: new Date(T0.getTime() + 48 * HOUR) },
    });
    expect(await renewPush(db.prisma, clock, deps())).toEqual({
      created: 0,
      renewed: 1,
      failed: 0,
    });
    expect(stubFor(a.id).renew).toHaveBeenCalledTimes(1);
    expect(stubFor(b.id).renew).not.toHaveBeenCalled();
    const after = await db.prisma.pushSubscription.findUnique({ where: { accountId: a.id } });
    expect(after!.expiresAt.getTime()).toBeGreaterThan(T0.getTime() + 24 * HOUR);
  });

  test("a Graph renew 404 re-creates the subscription with a new externalId and hash", async () => {
    const a = await mk("MICROSOFT");
    await renewPush(db.prisma, clock, deps());
    const before = (await rows())[0]!;
    await db.prisma.pushSubscription.update({
      where: { accountId: a.id },
      data: { expiresAt: new Date(T0.getTime() + HOUR) },
    });
    stubFor(a.id).renew.mockRejectedValueOnce(new PushError("not_found"));
    expect(await renewPush(db.prisma, clock, deps())).toEqual({
      created: 1,
      renewed: 0,
      failed: 0,
    });
    const after = (await rows())[0]!;
    expect(after.externalId).not.toBe(before.externalId);
    expect(after.clientStateHash).not.toBe(before.clientStateHash);
    expect(after.status).toBe("ACTIVE");
  });

  test("local mode or missing env: no provider call", async () => {
    await mk("GMAIL");
    await mk("MICROSOFT");
    await renewPush(db.prisma, clock, deps({ ...vps, MODE: "local" }));
    await renewPush(db.prisma, clock, deps({ MODE: "vps", APP_URL: "http://app.rn.test" }));
    expect(providerCalls).toEqual([]);
    expect(await rows()).toHaveLength(0);
    // Gmail needs both vars; Graph needs only https
    await renewPush(db.prisma, clock, deps({ ...vps, GMAIL_PUSH_SA_EMAIL: undefined }));
    expect((await rows()).map((r) => r.provider)).toEqual(["MICROSOFT"]);
  });

  test("accounts without credentials, disconnected or deleted are skipped", async () => {
    await mk("GMAIL", { credentialsEnc: null });
    await mk("GMAIL", { status: "DISCONNECTED" });
    await mk("GMAIL", { deletedAt: T0 });
    expect(await renewPush(db.prisma, clock, deps())).toEqual({
      created: 0,
      renewed: 0,
      failed: 0,
    });
  });

  test("a failure is FAILED with the code and an audit row, retried on the next tick", async () => {
    const a = await mk("GMAIL");
    stubFor(a.id).subscribe.mockRejectedValueOnce(
      new TransientBeforeSendError("pubsub_permission"),
    );
    expect(await renewPush(db.prisma, clock, deps())).toEqual({
      created: 0,
      renewed: 0,
      failed: 1,
    });
    expect(await rows()).toMatchObject([
      { status: "FAILED", lastError: "pubsub_permission", externalId: null },
    ]);
    const audits = await db.prisma.auditLog.findMany({
      where: { action: "push.failed", target: a.id },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.meta)).toContain("pubsub_permission");

    clock.advance(30 * 60_000);
    expect(await renewPush(db.prisma, clock, deps())).toEqual({
      created: 1,
      renewed: 0,
      failed: 0,
    });
    expect(await rows()).toMatchObject([{ status: "ACTIVE", lastError: null }]);
    // a failed renew of an existing row does not write a second audit row per tick
    await db.prisma.pushSubscription.updateMany({
      data: { expiresAt: new Date(clock.now().getTime() + HOUR) },
    });
    stubFor(a.id).renew.mockRejectedValue(new TransientBeforeSendError("gmail 503"));
    await renewPush(db.prisma, clock, deps());
    await renewPush(db.prisma, clock, deps());
    expect(await db.prisma.auditLog.count({ where: { action: "push.failed", target: a.id } })).toBe(
      2,
    );
  });

  test("an AuthError goes through recordProviderError: NEEDS_ATTENTION, unless the user paused it", async () => {
    const a = await mk("GMAIL");
    const p = await mk("MICROSOFT", { lifecycle: "PAUSED" });
    stubFor(a.id).subscribe.mockRejectedValue(new AuthError("invalid_grant"));
    stubFor(p.id).subscribe.mockRejectedValue(new AuthError("invalid_grant"));
    expect((await renewPush(db.prisma, clock, deps())).failed).toBe(2);
    expect((await getAccount(db.prisma, ws, a.id))!.lifecycle).toBe("NEEDS_ATTENTION");
    expect((await getAccount(db.prisma, ws, p.id))!.lifecycle).toBe("PAUSED");
    expect((await rows()).map((r) => r.lastError)).toEqual(["invalid_grant", "invalid_grant"]);
  });

  test("two concurrent runs: one subscription per account, the extra Graph one is unsubscribed", async () => {
    const m = await mk("MICROSOFT");
    const s = stubFor(m.id);
    s.subscribe.mockImplementation(async () => {
      await bothStarted(s);
      return { externalId: `ext-${++n}`, expiresAt: new Date(T0.getTime() + 7 * 24 * HOUR) };
    });
    const out = await Promise.all([
      renewPush(db.prisma, clock, deps()),
      renewPush(db.prisma, clock, deps()),
    ]);
    expect(out.map((x) => x.created).sort()).toEqual([0, 1]); // the lost race is not a creation
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(s.subscribe).toHaveBeenCalledTimes(2);
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    const lost = s.subscribe.mock.results.map((x) => x.value) as Promise<{ externalId: string }>[];
    const ids = (await Promise.all(lost)).map((x) => x.externalId);
    expect(ids).toContain(r[0]!.externalId);
    expect(s.unsubscribe).toHaveBeenCalledWith(ids.find((i) => i !== r[0]!.externalId));
  });

  test("a lost Gmail race does not stop the winner's watch (watch is per mailbox)", async () => {
    const g = await mk("GMAIL");
    const s = stubFor(g.id);
    s.subscribe.mockImplementation(async () => {
      await bothStarted(s);
      return { externalId: `ext-${++n}`, expiresAt: new Date(T0.getTime() + 7 * 24 * HOUR) };
    });
    await Promise.all([renewPush(db.prisma, clock, deps()), renewPush(db.prisma, clock, deps())]);
    expect(await rows()).toHaveLength(1);
    expect(s.unsubscribe).not.toHaveBeenCalled();
  });
  test.each(["GMAIL", "MICROSOFT"] as const)(
    "%s: a disconnect between subscribe and insert leaves no row and unsubscribes once",
    async (provider) => {
      const a = await mk(provider);
      const s = stubFor(a.id);
      s.subscribe.mockImplementation(async () => {
        const stub = { ...s, revoke: async () => {}, kind: provider } as unknown as MailProvider;
        await disconnectAccount(db.prisma, ws, a.id, { clock, providerFor: () => stub });
        return { externalId: "late-1", expiresAt: new Date(T0.getTime() + 7 * 24 * HOUR) };
      });
      const r = await renewPush(db.prisma, clock, deps());
      expect(r.created).toBe(0);
      expect(await rows()).toHaveLength(0);
      expect(s.unsubscribe).toHaveBeenCalledTimes(1);
      expect(s.unsubscribe).toHaveBeenCalledWith("late-1");
    },
  );

  test("a failure after a disconnect records no placeholder row", async () => {
    const a = await mk("GMAIL");
    const s = stubFor(a.id);
    s.subscribe.mockImplementation(async () => {
      const stub = { ...s, revoke: async () => {}, kind: "GMAIL" } as unknown as MailProvider;
      await disconnectAccount(db.prisma, ws, a.id, { clock, providerFor: () => stub });
      throw new TransientBeforeSendError("gmail 503");
    });
    await renewPush(db.prisma, clock, deps());
    expect(await rows()).toHaveLength(0);
    expect(await db.prisma.auditLog.count({ where: { action: "push.failed", target: a.id } })).toBe(
      0,
    );
  });

  test("a permanently failing account does not starve the others", async () => {
    const bad = await mk("GMAIL");
    const good = await mk("GMAIL");
    const [first, second] = [bad, good].sort((x, y) => (x.id < y.id ? -1 : 1));
    stubFor(first!.id).subscribe.mockRejectedValue(
      new TransientBeforeSendError("pubsub_permission"),
    );
    const d = { ...deps(), batch: 1 };
    expect(await renewPush(db.prisma, clock, d)).toMatchObject({ failed: 1 });
    expect(await renewPush(db.prisma, clock, d)).toMatchObject({ created: 1 });
    expect(stubFor(second!.id).subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("disconnect and delete", () => {
  test("disconnect unsubscribes at the provider and deletes the row; a provider error is logged as a code only", async () => {
    const a = await mk("MICROSOFT");
    await renewPush(db.prisma, clock, deps());
    const ext = (await rows())[0]!.externalId;
    const s = stubFor(a.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.unsubscribe.mockRejectedValueOnce(new Error("Bearer secret-token body"));
    const stub = { ...s, revoke: async () => {}, kind: "MICROSOFT" } as unknown as MailProvider;
    await disconnectAccount(db.prisma, ws, a.id, { clock, providerFor: () => stub });
    expect(s.unsubscribe).toHaveBeenCalledWith(ext);
    expect(await rows()).toHaveLength(0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token");
    warn.mockRestore();
  });

  test("a healthy unsubscribe also removes the row", async () => {
    const a = await mk("GMAIL");
    await renewPush(db.prisma, clock, deps());
    const s = stubFor(a.id);
    const stub = { ...s, revoke: async () => {}, kind: "GMAIL" } as unknown as MailProvider;
    await disconnectAccount(db.prisma, ws, a.id, { clock, providerFor: () => stub });
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    expect(await rows()).toHaveLength(0);
  });
});

describe("account status line", () => {
  const set = (env: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvCache();
  };
  const push = async (id: string) => (await getAccount(db.prisma, ws, id, { clock }))!.push;
  const CONFIGURED = {
    MODE: "vps",
    APP_URL: "https://app.rn.test",
    GMAIL_PUBSUB_TOPIC: "projects/p/topics/t",
    GMAIL_PUSH_SA_EMAIL: "push@p.iam.gserviceaccount.com",
  };

  test("active, expired, failed, pending, not configured; IMAP has none", async () => {
    const g = await mk("GMAIL");
    const s = await mk("SMTP");
    try {
      // test env is MODE=local: nothing is configured
      expect(await push(g.id)).toEqual({ state: "not_configured", expiresAt: null, error: null });
      expect(await push(s.id)).toBeNull();
      set(CONFIGURED);
      expect(await push(g.id)).toEqual({ state: "pending", expiresAt: null, error: null });
      const at = new Date(clock.now().getTime() + 7 * 24 * HOUR);
      await db.prisma.pushSubscription.create({
        data: {
          workspaceId: ws,
          accountId: g.id,
          provider: "GMAIL",
          externalId: "x",
          expiresAt: at,
        },
      });
      expect(await push(g.id)).toEqual({ state: "active", expiresAt: at, error: null });
      // ACTIVE but past its expiry (the renew job is not keeping up)
      const past = new Date(clock.now().getTime() - HOUR);
      await db.prisma.pushSubscription.update({
        where: { accountId: g.id },
        data: { expiresAt: past },
      });
      expect(await push(g.id)).toEqual({ state: "expired", expiresAt: past, error: null });
      await db.prisma.pushSubscription.update({
        where: { accountId: g.id },
        data: { status: "FAILED", lastError: "pubsub_permission" },
      });
      expect(await push(g.id)).toMatchObject({ state: "failed", error: "pubsub_permission" });
      // the push env was removed after the row was written
      await db.prisma.pushSubscription.update({
        where: { accountId: g.id },
        data: { status: "ACTIVE", expiresAt: at },
      });
      set({ GMAIL_PUSH_SA_EMAIL: undefined });
      expect(await push(g.id)).toMatchObject({ state: "not_configured" });
    } finally {
      set({ MODE: "local", GMAIL_PUBSUB_TOPIC: undefined, GMAIL_PUSH_SA_EMAIL: undefined });
    }
  });
});
