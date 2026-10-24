import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { hashPassword } from "better-auth/crypto";
import { totp } from "../e2e/totp";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let userId: string;
let cookie: string;
let auth: typeof import("../lib/auth").auth;
let authRoute: typeof import("../app/api/auth/[...all]/route");
let setEnv: (mode: "local" | "vps") => Promise<void>;

const req = (
  path: string,
  o: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  new Request(`${ORIGIN}${path}`, {
    method: o.method ?? "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...o.headers },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
const p = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const ip = (n: number | string) => ({ "x-real-ip": `203.0.113.${n}` });
const signIn = (
  email: string,
  headers: Record<string, string> = {},
  password = "wrong-password!",
) => authRoute.POST(req("/api/auth/sign-in/email", { body: { email, password }, headers }));
/** Fixed windows: start each block early in a minute (900 s windows are minute-aligned too) so none straddles an edge. */
const freshWindow = async () => {
  const into = Date.now() % 60_000;
  if (into > 40_000) await new Promise((r) => setTimeout(r, 60_000 - into + 500));
};
const keyFor = async (ws: string, scopes: string[]) => {
  const { createApiKey } = await import("@rightnow/core");
  return (await createApiKey(db.prisma, ws, "k", scopes)).token;
};

beforeAll(async () => {
  db = await createTestDb();
  const base = {
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-web-sec-")),
    API_RATE_LIMIT_PER_MIN: "3",
  };
  const { resetEnvCache } = await import("@rightnow/core");
  const { resetWebEnvCache } = await import("../lib/env");
  setEnv = async (mode) => {
    Object.assign(process.env, base, { MODE: mode });
    // the Fake mail provider is refused in vps mode
    if (mode === "vps") delete process.env.MAIL_PROVIDER_FAKE;
    else process.env.MAIL_PROVIDER_FAKE = "1";
    resetEnvCache();
    resetWebEnvCache();
  };
  await setEnv("local");
  ({ auth } = await import("../lib/auth"));
  authRoute = await import("../app/api/auth/[...all]/route");
  ({ workspaceId } = await createFirstOwner(
    db.prisma,
    { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
    TOKEN,
  ));
  userId = (await db.prisma.user.findFirstOrThrow({ where: { email: "owner@x.io" } })).id;
  const { headers } = await auth.api.signInEmail({
    body: { email: "owner@x.io", password: PASSWORD },
    returnHeaders: true,
  });
  cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
afterAll(() => db.drop());

describe("api limit", () => {
  it("the 4th API-key request of a workspace in a minute is 429; keys share it; others are unaffected", async () => {
    await freshWindow();
    const list = await import("../app/api/v1/webhooks/route");
    const get = (headers: Record<string, string>) =>
      list.GET(req("/api/v1/webhooks", { method: "GET", headers }));
    const k1 = await keyFor(workspaceId, ["webhooks:read"]);
    const k2 = await keyFor(workspaceId, ["webhooks:read"]);
    const other = (await db.prisma.workspace.create({ data: { name: "B", slug: "b-sec" } })).id;
    const k3 = await keyFor(other, ["webhooks:read"]);
    const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
    expect((await get(bearer(k1))).status).toBe(200);
    expect((await get(bearer(k2))).status).toBe(200);
    expect((await get(bearer(k1))).status).toBe(200);
    const r = await get(bearer(k2));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await r.json()).toEqual({ error: "rate_limited" });
    expect((await get(bearer(k3))).status).toBe(200);
    expect((await get({ cookie })).status).toBe(200); // sessions are not counted
    expect((await get({ cookie })).status).toBe(200);
  });
});

describe("local mode", () => {
  it("X-Real-IP is ignored: every caller shares `local`", async () => {
    await freshWindow();
    for (let i = 0; i < 5; i++) expect((await signIn(`l${i}@x.io`, ip(i))).status).toBe(401);
    expect((await signIn("l9@x.io", ip(99))).status).toBe(429);
  });

  it("setup: the 11th POST in 15 minutes is 429", async () => {
    const setup = await import("../app/api/setup/route");
    const body = {
      name: "N",
      email: "n@x.io",
      password: PASSWORD,
      workspaceName: "W",
      token: "wrong-token-123456",
    };
    for (let i = 0; i < 10; i++)
      expect((await setup.POST(req("/api/setup", { body }))).status).not.toBe(429);
    const r = await setup.POST(req("/api/setup", { body }));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });

  it("test-connection: the 11th per user is 429; the body carries only trimmed checks", async () => {
    await freshWindow();
    const route = await import("../app/api/v1/accounts/test-connection/route");
    const srv = (host: string) => ({
      host,
      port: 993,
      secure: true,
      username: "u",
      password: "hunter2",
    });
    const body = {
      email: "a@acme.io",
      firstName: "A",
      lastName: "",
      imap: srv("fail.acme.io"),
      smtp: srv("smtp.acme.io"),
    };
    const post = () =>
      route.POST(req("/api/v1/accounts/test-connection", { body, headers: { cookie } }));
    const first = await post();
    expect(first.status).toBe(200);
    const j = (await first.json()) as { ok: boolean; checks: Record<string, unknown>[] };
    expect(Object.keys(j).sort()).toEqual(["checks", "ok"]);
    for (const c of j.checks)
      for (const k of Object.keys(c))
        expect(["name", "ok", "code", "message", "reply"]).toContain(k);
    for (let i = 0; i < 9; i++) expect((await post()).status).toBe(200);
    const r = await post();
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });

  it("oauth start: the 21st per user is 429", async () => {
    const start = await import("../app/api/v1/oauth/[provider]/start/route");
    const post = () =>
      start.POST(
        req("/api/v1/oauth/google/start", { body: {}, headers: { cookie } }),
        p({ provider: "google" }),
      );
    for (let i = 0; i < 20; i++) expect((await post()).status).not.toBe(429);
    expect((await post()).status).toBe(429);
  });

  it("webhook test: the 11th per workspace in a minute is 429", async () => {
    await freshWindow();
    const test = await import("../app/api/v1/webhooks/[id]/test/route");
    const post = () =>
      test.POST(req("/api/v1/webhooks/nope/test", { headers: { cookie } }), p({ id: "nope" }));
    for (let i = 0; i < 10; i++) expect((await post()).status).toBe(404);
    const r = await post();
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "rate_limited" });
  });

  it("ai: past 30 calls a minute a feature route is 429 with Retry-After", async () => {
    await freshWindow();
    const { setAiSettings } = await import("@rightnow/core");
    await setAiSettings(
      db.prisma,
      workspaceId,
      null,
      { baseUrl: "https://llm.example.com/v1", apiKey: "sk-x", model: "m" },
      { allowPrivate: false, resolve: async () => ["93.184.216.34"] },
    );
    const lead = await db.prisma.lead.create({ data: { workspaceId, email: "lead@x.io" } });
    const now = Date.now();
    // 30 calls already made in this minute
    await db.prisma.rateLimitBucket.create({
      data: { key: `ws:${workspaceId}:ai`, windowStart: new Date(now - (now % 60_000)), count: 30 },
    });
    const score = await import("../app/api/v1/ai/score/route");
    const r = await score.POST(
      req("/api/v1/ai/score", { body: { leadId: lead.id }, headers: { cookie } }),
    );
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await r.json()).toMatchObject({ error: "rate_limited" });
  });
});

describe("vps mode", () => {
  beforeAll(() => setEnv("vps"));
  afterAll(() => setEnv("local"));

  it("sign-in: the 6th POST from one X-Real-IP is 429; another IP is allowed", async () => {
    await freshWindow();
    for (let i = 0; i < 5; i++) expect((await signIn(`v${i}@x.io`, ip(9))).status).toBe(401);
    const r = await signIn("v5@x.io", ip(9));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await signIn("v6@x.io", ip(10))).status).toBe(401);
  });

  it("sign-in: 11 failed attempts for one email from 11 IPs, the 11th is 429; successes are not counted", async () => {
    await freshWindow();
    for (let i = 0; i < 10; i++)
      expect((await signIn("target@x.io", ip(`1${i}`))).status).toBe(401);
    expect((await signIn("target@x.io", ip(30))).status).toBe(429);
    for (let i = 0; i < 12; i++)
      expect((await signIn("owner@x.io", ip(100 + i), PASSWORD)).status).toBe(200);
  });

  it("without X-Real-IP every caller is `unknown` (fails closed)", async () => {
    await freshWindow();
    for (let i = 0; i < 5; i++) expect((await signIn(`u${i}@x.io`)).status).toBe(401);
    expect((await signIn("u5@x.io")).status).toBe(429);
  });

  it("2FA: 11 verify attempts for one user from 11 IPs, the 11th is 429 (all three paths share it)", async () => {
    await freshWindow();
    await db.prisma.verification.create({
      data: {
        id: "v-2fa",
        identifier: "2fa-ident",
        value: userId,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const paths = ["verify-totp", "verify-backup-code", "verify-otp"];
    const verify = (i: number) =>
      authRoute.POST(
        req(`/api/auth/two-factor/${paths[i % 3]}`, {
          body: { code: "123456" },
          headers: { ...ip(40 + i), cookie: "better-auth.two_factor=2fa-ident.c2ln" },
        }),
      );
    for (let i = 0; i < 10; i++) expect((await verify(i)).status).not.toBe(429);
    expect((await verify(10)).status).toBe(429);
  });

  it("2FA: a decoy cookie first or a quoted value still reaches the user bucket (better-call parsing)", async () => {
    await freshWindow();
    for (const [n, uid] of [
      ["decoy", "u-decoy"],
      ["quoted", "u-quoted"],
    ] as const) {
      await db.prisma.verification.create({
        data: {
          id: `v-${n}`,
          identifier: `id-${n}`,
          value: uid,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
    }
    const cookies = {
      // better-call reads the exact name `better-auth.two_factor`; the prefixed decoy must not hide it
      decoy: "__Secure-better-auth.two_factor=junk.c2ln; better-auth.two_factor=id-decoy.c2ln",
      quoted: 'better-auth.two_factor="id-quoted.c2ln"',
    };
    for (const [n, cookie] of Object.entries(cookies)) {
      const verify = (i: number) =>
        authRoute.POST(
          req("/api/auth/two-factor/verify-totp", {
            body: { code: "123456" },
            headers: { ...ip(`6${i}`), cookie },
          }),
        );
      for (let i = 0; i < 10; i++) expect((await verify(i)).status, n).not.toBe(429);
      expect((await verify(10)).status, n).toBe(429);
      await db.prisma.rateLimitBucket.deleteMany({
        where: { key: { startsWith: "ip:203.0.113.6" } },
      });
    }
  });

  it("2FA: a cookie that names no user is counted per IP on 2fa-nouser (fails closed)", async () => {
    const now = Date.now();
    await db.prisma.rateLimitBucket.create({
      data: {
        key: "ip:203.0.113.80:2fa-nouser",
        windowStart: new Date(now - (now % 900_000)),
        count: 10,
      },
    });
    const r = await authRoute.POST(
      req("/api/auth/two-factor/verify-totp", {
        body: { code: "123456" },
        headers: { ...ip(80), cookie: "better-auth.two_factor=nobody.c2ln" },
      }),
    );
    expect(r.status).toBe(429);
  });

  it("sign-in: form-encoded attempts count on the email bucket like JSON; other bodies are 415", async () => {
    await freshWindow();
    const form = (i: number) =>
      authRoute.POST(
        new Request(`${ORIGIN}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/x-www-form-urlencoded",
            ...ip(`7${i}`),
          },
          body: new URLSearchParams({ email: "Form@X.io", password: "wrong-password!" }).toString(),
        }),
      );
    for (let i = 0; i < 5; i++) expect((await form(i)).status).toBe(401);
    for (let i = 5; i < 10; i++) expect((await signIn("form@x.io", ip(`7${i}`))).status).toBe(401);
    expect((await form(10)).status).toBe(429);
    const text = await authRoute.POST(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "text/plain", ...ip(90) },
        body: "email=form@x.io",
      }),
    );
    expect(text.status).toBe(415);
    expect(await text.json()).toEqual({ error: "unsupported_media_type" });
  });

  it("2FA with the real plugin: TOTP, backup code and OTP verifies are counted per user across IPs; the code works once", async () => {
    await freshWindow();
    const email = "tf@x.io";
    const u = await db.prisma.user.create({ data: { id: "u-tf", name: "T", email } });
    await db.prisma.account.create({
      data: {
        id: "a-tf",
        userId: u.id,
        accountId: u.id,
        providerId: "credential",
        password: await hashPassword(PASSWORD),
      },
    });
    await db.prisma.member.create({
      data: { id: "m-tf", workspaceId, userId: u.id, role: "member" },
    });
    const first = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const headers = new Headers({
      cookie: first.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    const enabled = (await auth.api.enableTwoFactor({
      headers,
      body: { password: PASSWORD },
    })) as { totpURI: string; backupCodes: string[] };
    const secret = new URL(enabled.totpURI).searchParams.get("secret")!;
    await auth.api.verifyTOTP({ headers, body: { code: totp(secret) } });
    expect(
      await db.prisma.auditLog.count({
        where: { workspaceId, actorId: u.id, action: "auth.2fa_enable" },
      }),
    ).toBe(1);

    const challenge = async (i: number) => {
      const r = await signIn(email, ip(110 + i), PASSWORD);
      expect(await r.json()).toMatchObject({ twoFactorRedirect: true });
      return r.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .find((c) => c!.startsWith("better-auth.two_factor="))!;
    };
    const paths = ["verify-totp", "verify-backup-code", "verify-otp"];
    const verify = async (i: number, path: string, code: string) =>
      authRoute.POST(
        req(`/api/auth/two-factor/${path}`, {
          body: { code },
          headers: { ...ip(110 + i), cookie: await challenge(i) },
        }),
      );
    // the plugin really answers (not 404): a wrong code is 401 on each path it serves
    for (let i = 0; i < 10; i++) {
      const r = await verify(i, paths[i % 3]!, "000000");
      expect(r.status, paths[i % 3]).not.toBe(404);
      expect(r.status).not.toBe(429);
    }
    expect((await verify(10, "verify-totp", totp(secret))).status).toBe(429); // right code, over the user budget

    // a backup code signs in once (a fresh budget: the buckets are per window)
    await db.prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "user:" } } });
    const ok = await verify(11, "verify-backup-code", enabled.backupCodes[0]!);
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie().join(";")).toContain("session_token");
    expect((await verify(12, "verify-backup-code", enabled.backupCodes[0]!)).status).toBe(401);
    expect((await verify(13, "verify-totp", totp(secret))).status).toBe(200);
    // M1: sign-in is audited once per usable session: the first password sign-in and the two successful verifies
    // (not the password step of a 2FA sign-in, and not enabling 2FA)
    expect(
      await db.prisma.auditLog.count({ where: { actorId: u.id, action: "auth.sign_in" } }),
    ).toBe(3);
  });

  it("clientIp buckets IPv6 by /64 and keeps IPv4 as is", async () => {
    const { clientIp } = await import("../lib/ratelimit");
    const at = (v: string) => clientIp(new Request(ORIGIN, { headers: { "x-real-ip": v } }), "vps");
    expect(at("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(at("2001:db8:1:2::9")).toBe("2001:db8:1:2::/64");
    expect(at("2001:0db8:0001:0002:ffff::1")).toBe("2001:db8:1:2::/64");
    expect(at("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(at("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(at("203.0.113.9")).toBe("203.0.113.9");
  });

  it("A9: vps mode without X-Real-IP fails closed, warns once with a code only, and readyz reports it", async () => {
    const { vi } = await import("vitest");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { clientIp } = await import("../lib/ratelimit");
    expect(clientIp(new Request(ORIGIN), "vps")).toBe("unknown");
    expect(clientIp(new Request(ORIGIN), "vps")).toBe("unknown");
    const calls = warn.mock.calls.filter((c) => c[0] === "x_real_ip_missing");
    expect(calls.length).toBeLessThanOrEqual(1); // an earlier vps request in this file may have warned already
    for (const c of calls) expect(c).toEqual(["x_real_ip_missing"]);
    warn.mockRestore();
    const ready = await import("../app/api/readyz/route");
    expect(await (await ready.GET(new Request(`${ORIGIN}/api/readyz`))).json()).toMatchObject({
      proxy: "x_real_ip_missing",
    });
  });

  it("push: a flood from one IP is 429 with Retry-After (the provider redelivers); other IPs pass", async () => {
    const push = await import("../lib/push");
    const now = Date.now();
    const windowStart = new Date(now - (now % 60_000));
    for (const k of ["push-gmail", "push-graph"])
      await db.prisma.rateLimitBucket.create({
        data: { key: `ip:203.0.113.77:${k}`, windowStart, count: 600 },
      });
    const g = await push.gmailPush()(req("/api/push/gmail", { body: {}, headers: ip(77) }));
    expect(g.status).toBe(429);
    expect(g.headers.get("retry-after")).toBeTruthy();
    const m = await push.graphPush()(
      req("/api/push/graph", { body: { value: [] }, headers: ip(77) }),
    );
    expect(m.status).toBe(429);
    expect(
      (await push.gmailPush()(req("/api/push/gmail", { body: {}, headers: ip(78) }))).status,
    ).toBe(401);
  });
});
