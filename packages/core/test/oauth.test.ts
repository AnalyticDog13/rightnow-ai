import { createHash } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import { GoogleOAuth, createFixtureFetch } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { decryptCredentials } from "../src/accounts/credentials";
import { fixedClock } from "../src/clock";
import { decrypt } from "../src/crypto";
import { resetEnvCache } from "../src/env";
import {
  cancelSession,
  completeOAuth,
  missingScopes,
  pkce,
  pollSession,
  startOAuth,
} from "../src/oauth";
import { seedAccount, testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  testEnv();
  db = await createTestDb();
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
});
afterAll(async () => {
  await db.drop();
});

const T0 = new Date("2026-10-20T10:00:00Z");
const SCOPE =
  "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

/** Google double: code `code-<email>` -> access token `at-<email>` -> Gmail profile with that email. */
function google(o: { refresh?: boolean; scope?: string; tokenStatus?: number } = {}) {
  return createFixtureFetch([
    {
      method: "POST",
      url: "https://oauth2.googleapis.com/token",
      respond: (r) => {
        if (o.tokenStatus)
          return json({ error: "invalid_grant", error_description: "SECRET-BODY" }, o.tokenStatus);
        const email = new URLSearchParams(r.body).get("code")!.slice(5);
        return json({
          access_token: `at-${email}`,
          ...(o.refresh === false ? {} : { refresh_token: `rt-${email}` }),
          expires_in: 3600,
          scope: o.scope ?? SCOPE,
          token_type: "Bearer",
        });
      },
    },
    {
      method: "GET",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      respond: (r) => json({ emailAddress: r.headers.authorization!.slice(10) }),
    },
  ]);
}

async function setup() {
  const ws = await db.prisma.workspace.create({ data: { name: "W", slug: `w-${Math.random()}` } });
  return { workspaceId: ws.id, userId: "u1", clock: fixedClock(T0) };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
const stateOf = (authUrl: string) => new URL(authUrl).searchParams.get("state")!;
const begin = (c: Ctx, fetch: typeof globalThis.fetch, reconnectAccountId?: string) =>
  startOAuth(
    db.prisma,
    c.clock,
    { fetch },
    { workspaceId: c.workspaceId, userId: c.userId, provider: "google", reconnectAccountId },
  );
const finish = (
  c: Ctx,
  fetch: typeof globalThis.fetch,
  p: { state?: string; code?: string; error?: string; userId?: string; workspaceId?: string },
) =>
  completeOAuth(
    db.prisma,
    c.clock,
    { fetch },
    { workspaceId: c.workspaceId, userId: c.userId, ...p },
  );
async function connect(
  c: Ctx,
  email: string,
  o: Parameters<typeof google>[0] & { reconnectAccountId?: string } = {},
) {
  const fetch = google(o);
  const start = await begin(c, fetch, o.reconnectAccountId);
  const r = await finish(c, fetch, { state: stateOf(start.authUrl), code: `code-${email}` });
  return { ...r, start };
}
const session = (id: string) => db.prisma.oAuthSession.findUniqueOrThrow({ where: { id } });
const account = (id?: string) => db.prisma.emailAccount.findUniqueOrThrow({ where: { id } });
const count = (c: Ctx) => db.prisma.emailAccount.count({ where: { workspaceId: c.workspaceId } });

test("pkce matches RFC 7636 and fresh verifiers are valid", () => {
  expect(pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").challenge).toBe(
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  const v = pkce().verifier;
  expect(v.length).toBeGreaterThanOrEqual(43);
  expect(v.length).toBeLessThanOrEqual(128);
});

describe("startOAuth", () => {
  test("stores hash + encrypted verifier and builds the Google URL", async () => {
    const c = await setup();
    const s = await begin(c, google());
    const row = await session(s.sessionId);
    const u = new URL(s.authUrl);
    const state = stateOf(s.authUrl);
    expect(row.status).toBe("PENDING");
    expect(row.createdByUserId).toBe("u1");
    expect(row.expiresAt).toEqual(new Date(T0.getTime() + 600_000));
    expect(s.expiresAt).toEqual(row.expiresAt);
    expect(row.stateHash).toBe(createHash("sha256").update(state).digest("hex"));
    expect(row.codeVerifierEnc.startsWith("v1:")).toBe(true);
    const p = u.searchParams;
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(pkce(decrypt(row.codeVerifierEnc)).challenge);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("scope")).toBe(SCOPE);
    expect(p.get("redirect_uri")).toBe("http://localhost:3000/api/v1/oauth/google/callback");
    expect(p.get("client_id")).toBe("cid");
  });

  test("reconnectAccountId must be a live account of this workspace", async () => {
    const c = await setup();
    const other = await seedAccount(db.prisma, null, "o@example.com");
    await expect(begin(c, google(), other.id)).rejects.toMatchObject({ code: "account_not_found" });
  });

  test("not_configured without client id, unless the fake provider is on", async () => {
    const c = await setup();
    const p = { workspaceId: c.workspaceId, userId: "u1", provider: "google" as const };
    delete process.env.GOOGLE_CLIENT_ID;
    resetEnvCache();
    await expect(startOAuth(db.prisma, c.clock, {}, p)).rejects.toMatchObject({
      code: "not_configured",
    });
    await expect(
      startOAuth(db.prisma, c.clock, {}, { ...p, provider: "microsoft" }),
    ).rejects.toMatchObject({ code: "not_configured" });
    process.env.MAIL_PROVIDER_FAKE = "1";
    resetEnvCache();
    const s = await startOAuth(db.prisma, c.clock, {}, p);
    expect(s.authUrl).toContain("/api/v1/oauth/google/callback?code=fake");
    delete process.env.MAIL_PROVIDER_FAKE;
    process.env.GOOGLE_CLIENT_ID = "cid";
    resetEnvCache();
  });
});

describe("completeOAuth success", () => {
  test("creates an encrypted GMAIL account, session SUCCESS, audit", async () => {
    const c = await setup();
    const r = await connect(c, "Ann@Gmail.com");
    expect(r.errorCode).toBeUndefined();
    const a = await account(r.accountId);
    expect(a).toMatchObject({
      workspaceId: c.workspaceId,
      provider: "GMAIL",
      email: "ann@gmail.com",
      capTier: "GMAIL_CONSUMER",
      providerCap: 400,
      dailyLimit: 30,
      status: "CONNECTED",
    });
    expect(decryptCredentials(a.credentialsEnc!)).toMatchObject({
      kind: "oauth",
      refreshToken: "rt-Ann@Gmail.com",
      scope: SCOPE,
    });
    const raw = JSON.stringify(
      await db.prisma.$queryRaw`SELECT * FROM "EmailAccount" WHERE id = ${a.id}`,
    );
    expect(raw).not.toContain("rt-Ann");
    expect(raw).not.toContain("at-Ann");
    expect(await session(r.start.sessionId)).toMatchObject({ status: "SUCCESS", accountId: a.id });
    const log = await db.prisma.auditLog.findFirst({
      where: { workspaceId: c.workspaceId, action: "account.connect", target: a.id },
    });
    expect(log?.actorId).toBe("u1");
    expect(JSON.stringify(log?.meta)).not.toContain("rt-");
  });

  test("a Workspace domain gets the Workspace tier", async () => {
    const c = await setup();
    const a = await account((await connect(c, "b@corp.example")).accountId);
    expect([a.capTier, a.providerCap]).toEqual(["GMAIL_WORKSPACE", 1500]);
  });
});

describe("completeOAuth failures", () => {
  const fail = async (c: Ctx, o: Parameters<typeof connect>[2], code: string) => {
    const r = await connect(c, "f@corp.example", o);
    expect(r.errorCode).toBe(code);
    expect(r.accountId).toBeUndefined();
    expect(await count(c)).toBe(0);
    expect((await session(r.start.sessionId)).status).toBe("ERROR");
  };

  test("wrong state, other workspace, other user, replay -> state_invalid", async () => {
    const c = await setup();
    const fetch = google();
    expect((await finish(c, fetch, { state: "nope", code: "code-x@y.z" })).errorCode).toBe(
      "state_invalid",
    );
    expect((await finish(c, fetch, {})).errorCode).toBe("state_invalid");
    const s = await begin(c, fetch);
    const p = { state: stateOf(s.authUrl), code: "code-r@corp.example" };
    const ws2 = await db.prisma.workspace.create({
      data: { name: "W2", slug: `w-${Math.random()}` },
    });
    for (const who of [{ workspaceId: ws2.id }, { userId: "u2" }])
      expect((await finish(c, fetch, { ...who, ...p })).errorCode).toBe("state_invalid");
    expect((await session(s.sessionId)).status).toBe("PENDING"); // wrong callers did not consume it
    expect((await finish(c, fetch, p)).accountId).toBeTruthy();
    expect((await finish(c, fetch, p)).errorCode).toBe("state_invalid");
    expect((await session(s.sessionId)).status).toBe("SUCCESS");
  });

  test("expired after 10 min", async () => {
    const c = await setup();
    const fetch = google();
    const s = await begin(c, fetch);
    c.clock.advance(601_000);
    const r = await finish(c, fetch, { state: stateOf(s.authUrl), code: "code-e@corp.example" });
    expect(r.errorCode).toBe("expired");
    expect((await session(s.sessionId)).status).toBe("EXPIRED");
    expect(fetch.calls).toHaveLength(0);
  });

  test("access_denied", async () => {
    const c = await setup();
    const fetch = google();
    const s = await begin(c, fetch);
    const r = await finish(c, fetch, { state: stateOf(s.authUrl), error: "access_denied" });
    expect(r.errorCode).toBe("access_denied");
    expect(await session(s.sessionId)).toMatchObject({
      status: "ERROR",
      errorCode: "access_denied",
    });
  });

  test("no refresh token, missing scope, token 400", async () => {
    const c = await setup();
    await fail(c, { refresh: false }, "no_refresh_token");
    await fail(c, { scope: "https://www.googleapis.com/auth/gmail.send" }, "scope_missing");
    await fail(c, { tokenStatus: 400 }, "exchange_failed");
  });

  test("Google 5xx is provider_unavailable, not a rejection", async () => {
    await fail(await setup(), { tokenStatus: 503 }, "provider_unavailable");
  });

  test("errors never carry token or response text", async () => {
    const err = await new GoogleOAuth({
      clientId: "c",
      clientSecret: "s",
      fetch: google({ tokenStatus: 400 }),
    })
      .exchange({ code: "code-x@y.z", codeVerifier: "v", redirectUri: "http://x/cb" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const e = err as Error;
    expect(JSON.stringify(e) + e.stack + JSON.stringify(e.cause)).not.toMatch(/SECRET-BODY|code-x/);
  });
});

describe("races and duplicates", () => {
  test("same state twice -> one account, SUCCESS", async () => {
    const c = await setup();
    const fetch = google();
    const s = await begin(c, fetch);
    const p = { state: stateOf(s.authUrl), code: "code-d@corp.example" };
    const rs = await Promise.all([finish(c, fetch, p), finish(c, fetch, p)]);
    expect(rs.filter((r) => r.accountId)).toHaveLength(1);
    expect(await count(c)).toBe(1);
    expect((await session(s.sessionId)).status).toBe("SUCCESS");
  });

  test("two states for the same new email -> one SUCCESS, one account_exists", async () => {
    const c = await setup();
    const fetch = google();
    const code = "code-race@corp.example";
    const [a, b] = await Promise.all([begin(c, fetch), begin(c, fetch)]);
    const rs = await Promise.all([
      finish(c, fetch, { state: stateOf(a.authUrl), code }),
      finish(c, fetch, { state: stateOf(b.authUrl), code }),
    ]);
    expect(rs.map((r) => r.errorCode ?? "ok").sort()).toEqual(["account_exists", "ok"]);
    expect(await count(c)).toBe(1);
  });

  test("same email in any case without reconnect -> account_exists", async () => {
    const c = await setup();
    await connect(c, "dup@corp.example");
    const r = await connect(c, "DUP@corp.example");
    expect(r.errorCode).toBe("account_exists");
    expect((await session(r.start.sessionId)).errorCode).toBe("account_exists");
    expect(await count(c)).toBe(1);
  });
});

describe("reconnect", () => {
  const prep = async (data: object = {}) => {
    const c = await setup();
    const id = (await connect(c, "re@corp.example")).accountId!;
    await db.prisma.emailAccount.update({
      where: { id },
      data: {
        tags: ["a"],
        dailyLimit: 12,
        syncCursor: { kind: "fake", epoch: 1, seq: 2 },
        lastError: { kind: "CONNECTION", code: "x", message: "m" },
        errorCount24h: 4,
        status: "ERROR",
        ...data,
      },
    });
    return { c, id };
  };

  test("same id, new credentials, state reset, history kept, audit", async () => {
    const { c, id } = await prep({ lifecycle: "NEEDS_ATTENTION" });
    const before = (await account(id)).credentialsEnc;
    const r = await connect(c, "RE@corp.example", { reconnectAccountId: id });
    expect(r.accountId).toBe(id);
    const a = await account(id);
    expect(a.credentialsEnc).not.toBe(before);
    expect(a).toMatchObject({
      status: "CONNECTED",
      lastError: null,
      errorCount24h: 0,
      tags: ["a"],
      dailyLimit: 12,
      syncCursor: { kind: "fake", epoch: 1, seq: 2 },
      lifecycle: "ACTIVE",
    });
    expect(a.credentialGen).toBeGreaterThan(0);
    const audits = { workspaceId: c.workspaceId, action: "account.reconnect", target: id };
    expect(await db.prisma.auditLog.count({ where: audits })).toBe(1);
    expect(await count(c)).toBe(1);
  });

  test("lifecycle: user pause stays, PAUSED+DISCONNECTED resumes", async () => {
    const p1 = await prep({ lifecycle: "PAUSED", status: "CONNECTED" });
    await connect(p1.c, "re@corp.example", { reconnectAccountId: p1.id });
    expect((await account(p1.id)).lifecycle).toBe("PAUSED");
    const p2 = await prep({ lifecycle: "PAUSED", status: "DISCONNECTED", credentialsEnc: null });
    await connect(p2.c, "re@corp.example", { reconnectAccountId: p2.id });
    expect((await account(p2.id)).lifecycle).toBe("ACTIVE");
  });

  test("different email -> email_mismatch, account untouched", async () => {
    const { c, id } = await prep();
    const before = await account(id);
    const r = await connect(c, "other@corp.example", { reconnectAccountId: id });
    expect(r.errorCode).toBe("email_mismatch");
    expect(await account(id)).toEqual(before);
  });

  test("account deleted mid-flow -> error, never success", async () => {
    const { c, id } = await prep();
    const fetch = google();
    const s = await begin(c, fetch, id);
    await db.prisma.emailAccount.update({ where: { id }, data: { deletedAt: new Date() } });
    const r = await finish(c, fetch, { state: stateOf(s.authUrl), code: "code-re@corp.example" });
    expect(r.accountId).toBeUndefined();
    expect(r.errorCode).toBe("server_error");
    expect((await session(s.sessionId)).status).toBe("ERROR");
    expect((await account(id)).deletedAt).not.toBeNull();
  });
});

describe("reconnect provider mismatch", () => {
  const smtp = (c: Ctx) =>
    db.prisma.emailAccount.create({
      data: {
        workspaceId: c.workspaceId,
        provider: "SMTP",
        email: "x@corp.example",
        fromName: "X",
        firstName: "X",
        lastName: "",
        capTier: "SMTP",
        providerCap: 100,
        credentialsEnc: null,
      },
    });

  test("start rejects an SMTP account", async () => {
    const c = await setup();
    const a = await smtp(c);
    await expect(begin(c, google(), a.id)).rejects.toMatchObject({ code: "account_not_found" });
  });

  test("complete rejects an account that changed provider since start", async () => {
    const c = await setup();
    const fetch = google();
    const a = await smtp(c);
    await db.prisma.emailAccount.update({ where: { id: a.id }, data: { provider: "GMAIL" } });
    const s = await begin(c, fetch, a.id);
    await db.prisma.emailAccount.update({ where: { id: a.id }, data: { provider: "SMTP" } });
    const r = await finish(c, fetch, { state: stateOf(s.authUrl), code: "code-x@corp.example" });
    expect(r.errorCode).toBe("server_error");
    expect(await account(a.id)).toMatchObject({ provider: "SMTP", credentialsEnc: null });
  });
});

describe("reviving a soft-deleted account", () => {
  test("two concurrent connects revive it once", async () => {
    const c = await setup();
    const dead = await db.prisma.emailAccount.create({
      data: {
        workspaceId: c.workspaceId,
        provider: "SMTP",
        email: "cr@corp.example",
        fromName: "R",
        firstName: "R",
        lastName: "",
        capTier: "SMTP",
        providerCap: 100,
        deletedAt: new Date(),
      },
    });
    const fetch = google();
    const code = "code-cr@corp.example";
    const [a, b] = await Promise.all([begin(c, fetch), begin(c, fetch)]);
    const rs = await Promise.all([
      finish(c, fetch, { state: stateOf(a.authUrl), code }),
      finish(c, fetch, { state: stateOf(b.authUrl), code }),
    ]);
    expect(rs.map((r) => r.errorCode ?? "ok").sort()).toEqual(["account_exists", "ok"]);
    expect(await count(c)).toBe(1);
    expect(
      await db.prisma.auditLog.count({ where: { action: "account.connect", target: dead.id } }),
    ).toBe(1);
  });

  test("re-derives provider and cap tier; newest row wins", async () => {
    const c = await setup();
    const mk = (createdAt: Date) =>
      db.prisma.emailAccount.create({
        data: {
          workspaceId: c.workspaceId,
          provider: "SMTP",
          email: "rv@gmail.com",
          fromName: "R",
          firstName: "R",
          lastName: "",
          capTier: "SMTP",
          providerCap: 100,
          dailyLimit: 50,
          deletedAt: new Date(),
          createdAt,
        },
      });
    const old = await mk(new Date("2026-01-01"));
    const newer = await mk(new Date("2026-02-01"));
    const r = await connect(c, "rv@gmail.com");
    expect(r.accountId).toBe(newer.id);
    expect(await account(newer.id)).toMatchObject({
      provider: "GMAIL",
      capTier: "GMAIL_CONSUMER",
      providerCap: 400,
      dailyLimit: 50,
      deletedAt: null,
      status: "CONNECTED",
    });
    expect((await account(old.id)).deletedAt).not.toBeNull();
    expect(
      await db.prisma.auditLog.count({ where: { action: "account.connect", target: newer.id } }),
    ).toBe(1);
  });
});

describe("pollSession", () => {
  test("pending, success read once, expired, other workspace", async () => {
    const c = await setup();
    const fetch = google();
    const s = await begin(c, fetch);
    const poll = (ws = c.workspaceId, id = s.sessionId) => pollSession(db.prisma, c.clock, ws, id);
    expect(await poll()).toEqual({ status: "pending" });
    expect(await poll("other")).toBeNull();
    const r = await finish(c, fetch, { state: stateOf(s.authUrl), code: "code-p@corp.example" });
    expect(await poll("other")).toBeNull();
    expect(await poll()).toEqual({ status: "success", accountId: r.accountId });
    expect(await poll()).toBeNull();

    const s2 = await begin(c, fetch);
    c.clock.advance(601_000);
    expect(await poll(c.workspaceId, s2.sessionId)).toEqual({
      status: "expired",
      errorCode: "expired",
    });
  });

  test("error result carries errorCode", async () => {
    const c = await setup();
    const r = await connect(c, "q@corp.example", { refresh: false });
    expect(await pollSession(db.prisma, c.clock, c.workspaceId, r.start.sessionId)).toEqual({
      status: "error",
      errorCode: "no_refresh_token",
    });
  });
});

describe("cancelSession", () => {
  test("invalidates a pending session: a later callback is state_invalid and nothing is created", async () => {
    const c = await setup();
    const fetch = google();
    const start = await begin(c, fetch);
    expect(await cancelSession(db.prisma, c.workspaceId, c.userId, start.sessionId)).toBe(true);
    const r = await finish(c, fetch, {
      state: stateOf(start.authUrl),
      code: "code-late@example.com",
    });
    expect(r.errorCode).toBe("state_invalid");
    expect(await count(c)).toBe(0);
    expect(await pollSession(db.prisma, c.clock, c.workspaceId, start.sessionId)).toBeNull();
  });

  test("other workspace or user cannot cancel; a finished session is left alone", async () => {
    const c = await setup();
    const start = await begin(c, google());
    expect(await cancelSession(db.prisma, "other", c.userId, start.sessionId)).toBe(false);
    expect(await cancelSession(db.prisma, c.workspaceId, "u2", start.sessionId)).toBe(false);
    expect((await session(start.sessionId)).status).toBe("PENDING");
    const done = await connect(c, "done@example.com");
    expect(await cancelSession(db.prisma, c.workspaceId, c.userId, done.start.sessionId)).toBe(
      false,
    );
    expect((await session(done.start.sessionId)).status).toBe("SUCCESS");
  });
});

describe("missingScopes", () => {
  test("is per provider", () => {
    expect(missingScopes("google", SCOPE)).toEqual([]);
    expect(missingScopes("google", "https://www.googleapis.com/auth/gmail.send")).toHaveLength(1);
    // Microsoft grants are normalized and judged by Microsoft's scopes, not Google's
    expect(missingScopes("microsoft", "offline_access User.Read Mail.Send Mail.ReadWrite")).toEqual(
      [],
    );
    expect(
      missingScopes(
        "microsoft",
        "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite",
      ),
    ).toEqual([]);
    expect(missingScopes("microsoft", "Mail.Send")).toEqual(["Mail.ReadWrite"]);
    expect(missingScopes("microsoft", SCOPE)).toEqual(["Mail.Send", "Mail.ReadWrite"]);
  });
});
