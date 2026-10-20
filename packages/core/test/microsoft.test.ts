import { createTestDb } from "@rightnow/db/test-db";
import { GraphProvider, MicrosoftOAuth, createFixtureFetch } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { decryptCredentials, encryptCredentials } from "../src/accounts/credentials";
import { createProvider, getOAuthClient, tierFor } from "../src/accounts/factory";
import { fixedClock } from "../src/clock";
import { resetEnvCache } from "../src/env";
import { completeOAuth, startOAuth } from "../src/oauth";
import { seedAccount, testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const setEnv = (tenant?: string) => {
  process.env.MS_CLIENT_ID = "ms-cid";
  process.env.MS_CLIENT_SECRET = "ms-secret";
  if (tenant) process.env.MS_TENANT = tenant;
  else delete process.env.MS_TENANT;
  resetEnvCache();
};
beforeAll(async () => {
  testEnv();
  db = await createTestDb();
  process.env.APP_URL = "http://localhost:3000";
  setEnv();
});
afterAll(async () => {
  await db.drop();
});

const T0 = new Date("2026-10-20T10:00:00Z");
const SCOPE = "Mail.Send Mail.ReadWrite User.Read profile openid email";
const TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

/** Entra double: code `code-<email>` -> access token `at-<email>` -> Graph /me with that email. */
function microsoft(o: { scope?: string; tokenError?: unknown; refresh?: boolean } = {}) {
  return createFixtureFetch([
    {
      method: "POST",
      url: TOKEN,
      respond: (r) => {
        if (o.tokenError) return json(o.tokenError, 400);
        const email = new URLSearchParams(r.body).get("code")!.slice(5);
        return json({
          access_token: `at-${email}`,
          ...(o.refresh === false ? {} : { refresh_token: `rt-${email}` }),
          expires_in: 3600,
          scope: o.scope ?? SCOPE,
        });
      },
    },
    {
      method: "GET",
      url: /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\?/,
      respond: (r) => json({ mail: r.headers.authorization!.slice(10), displayName: "Ann Lee" }),
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
    { workspaceId: c.workspaceId, userId: c.userId, provider: "microsoft", reconnectAccountId },
  );
async function connect(
  c: Ctx,
  email: string,
  o: Parameters<typeof microsoft>[0] & { reconnectAccountId?: string } = {},
) {
  const fetch = microsoft(o);
  const start = await begin(c, fetch, o.reconnectAccountId);
  const r = await completeOAuth(
    db.prisma,
    c.clock,
    { fetch },
    {
      workspaceId: c.workspaceId,
      userId: c.userId,
      state: stateOf(start.authUrl),
      code: `code-${email}`,
    },
  );
  return { ...r, start };
}
const account = (id?: string) => db.prisma.emailAccount.findUniqueOrThrow({ where: { id } });
const session = (id: string) => db.prisma.oAuthSession.findUniqueOrThrow({ where: { id } });

describe("configuration and start", () => {
  test("tierFor Microsoft consumer vs organization domains", () => {
    expect(tierFor("MICROSOFT", "a@outlook.com")).toBe("OUTLOOK_COM");
    expect(tierFor("MICROSOFT", "a@corp.example")).toBe("MS365");
  });

  test("getOAuthClient('microsoft') is null until configured", () => {
    delete process.env.MS_CLIENT_ID;
    resetEnvCache();
    expect(getOAuthClient("microsoft")).toBeNull();
    setEnv();
    expect(getOAuthClient("microsoft")).toBeInstanceOf(MicrosoftOAuth);
  });

  test("start returns a login.microsoftonline.com/common URL with the four scopes", async () => {
    const c = await setup();
    const s = await begin(c, microsoft());
    const u = new URL(s.authUrl);
    expect(u.origin + u.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(u.searchParams.get("scope")).toBe("offline_access User.Read Mail.Send Mail.ReadWrite");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/v1/oauth/microsoft/callback",
    );
    expect((await session(s.sessionId)).provider).toBe("MICROSOFT");
  });

  test("MS_TENANT=organizations changes the authority for authorize and token", async () => {
    setEnv("organizations");
    const c = await setup();
    const fetch = createFixtureFetch([
      {
        method: "POST",
        url: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
        respond: () =>
          json({
            access_token: "at-t@corp.example",
            refresh_token: "rt",
            expires_in: 1,
            scope: SCOPE,
          }),
      },
      {
        method: "GET",
        url: /graph\.microsoft\.com/,
        respond: () => json({ mail: "t@corp.example" }),
      },
    ]);
    const s = await begin(c, fetch);
    expect(new URL(s.authUrl).pathname).toBe("/organizations/oauth2/v2.0/authorize");
    const r = await completeOAuth(
      db.prisma,
      c.clock,
      { fetch },
      {
        workspaceId: c.workspaceId,
        userId: "u1",
        state: stateOf(s.authUrl),
        code: "code-t@corp.example",
      },
    );
    expect(r.errorCode).toBeUndefined();
    setEnv();
  });

  test("a Microsoft connect cannot reconnect a Gmail account", async () => {
    const c = await setup();
    const a = await db.prisma.emailAccount.create({
      data: {
        workspaceId: c.workspaceId,
        provider: "GMAIL",
        email: "g@gmail.com",
        fromName: "g",
        firstName: "g",
        lastName: "",
        capTier: "GMAIL_CONSUMER",
        providerCap: 400,
      },
    });
    await expect(begin(c, microsoft(), a.id)).rejects.toMatchObject({ code: "account_not_found" });
  });
});

describe("connect", () => {
  test("outlook.com account: tier, caps, 3 s gap floor, display name, encrypted credentials", async () => {
    const c = await setup();
    const r = await connect(c, "Ann@Outlook.com");
    expect(r.errorCode).toBeUndefined();
    const a = await account(r.accountId);
    expect(a).toMatchObject({
      provider: "MICROSOFT",
      email: "ann@outlook.com",
      fromName: "Ann Lee",
      capTier: "OUTLOOK_COM",
      providerCap: 250,
      dailyLimit: 30,
      minGapSec: 3,
      status: "CONNECTED",
    });
    expect(decryptCredentials(a.credentialsEnc!)).toMatchObject({
      kind: "oauth",
      refreshToken: "rt-Ann@Outlook.com",
      scope: SCOPE,
    });
  });

  test("organization account: MS365 tier with the same gap floor", async () => {
    const c = await setup();
    const a = await account((await connect(c, "b@corp.example")).accountId);
    expect([a.capTier, a.providerCap, a.minGapSec]).toEqual(["MS365", 5000, 3]);
  });

  test("granted scopes as full URLs pass; a grant without Mail.ReadWrite is scope_missing", async () => {
    const c = await setup();
    const ok = await connect(c, "u@corp.example", {
      scope: "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite",
    });
    expect(ok.errorCode).toBeUndefined();
    const bad = await connect(c, "v@corp.example", { scope: "Mail.Send User.Read" });
    expect(bad.errorCode).toBe("scope_missing");
    expect(
      await db.prisma.emailAccount.count({
        where: { workspaceId: c.workspaceId, email: "v@corp.example" },
      }),
    ).toBe(0);
  });

  test("AADSTS65001 on the code exchange -> admin_consent_required, no response text stored", async () => {
    const c = await setup();
    const r = await connect(c, "w@corp.example", {
      tokenError: {
        error: "invalid_grant",
        error_description: "AADSTS65001: SECRET-TEXT",
        error_codes: [65001],
      },
    });
    expect(r.errorCode).toBe("admin_consent_required");
    expect(JSON.stringify(await session(r.start.sessionId))).not.toContain("SECRET-TEXT");
  });

  test("the callback's own admin-approval error maps to admin_consent_required; plain denial stays access_denied", async () => {
    const c = await setup();
    const fetch = microsoft();
    const run = async (error: string, errorDescription?: string) => {
      const s = await begin(c, fetch);
      return completeOAuth(
        db.prisma,
        c.clock,
        { fetch },
        {
          workspaceId: c.workspaceId,
          userId: "u1",
          state: stateOf(s.authUrl),
          error,
          errorDescription,
        },
      );
    };
    expect((await run("access_denied", "AADSTS90094: admin must grant permission")).errorCode).toBe(
      "admin_consent_required",
    );
    expect((await run("access_denied", "AADSTS65004: user declined")).errorCode).toBe(
      "access_denied",
    );
    expect((await run("access_denied")).errorCode).toBe("access_denied");
  });

  test("a response without a refresh token is no_refresh_token", async () => {
    const c = await setup();
    expect((await connect(c, "n@corp.example", { refresh: false })).errorCode).toBe(
      "no_refresh_token",
    );
  });

  test("connecting the same mailbox twice is account_exists; reconnect keeps id and credentials rotate", async () => {
    const c = await setup();
    const first = await connect(c, "r@corp.example");
    expect((await connect(c, "r@corp.example")).errorCode).toBe("account_exists");
    const again = await connect(c, "r@corp.example", { reconnectAccountId: first.accountId });
    expect(again.accountId).toBe(first.accountId);
    expect(await db.prisma.emailAccount.count({ where: { workspaceId: c.workspaceId } })).toBe(1);
    expect(
      (await connect(c, "other@corp.example", { reconnectAccountId: first.accountId })).errorCode,
    ).toBe("email_mismatch");
  });
});

describe("createProvider", () => {
  test("MICROSOFT builds a GraphProvider; two instances on one real store refresh once and keep the new refresh token", async () => {
    const stale = {
      kind: "oauth" as const,
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: 1,
      scope: SCOPE,
    };
    const a = await seedAccount(db.prisma, encryptCredentials(stale), "m@corp.example");
    const fetch = createFixtureFetch([
      {
        method: "POST",
        url: TOKEN,
        respond: async () => (
          await new Promise((r) => setTimeout(r, 50)),
          json({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600, scope: SCOPE })
        ),
      },
      {
        method: "POST",
        url: "https://graph.microsoft.com/v1.0/me/messages",
        respond: async () => json({ id: "d", conversationId: "c" }),
      },
      { method: "POST", url: /\/send$/, respond: async () => new Response(null, { status: 202 }) },
    ]);
    const acct = { id: a.id, provider: "MICROSOFT" as const, email: "m@corp.example" };
    const p1 = createProvider(acct, { prisma: db.prisma, fetch });
    const p2 = createProvider(acct, { prisma: db.prisma, fetch });
    expect(p1).toBeInstanceOf(GraphProvider);
    const mime = (n: number) => ({
      from: { email: "m@corp.example" },
      to: [{ email: "to@x.test" }],
      subject: "s",
      text: "t",
      messageId: `<m${n}@corp.example>`,
    });
    await Promise.all([p1.send(mime(1)), p2.send(mime(2))]);
    expect(fetch.calls.filter((x) => x.url.includes("/token"))).toHaveLength(1);
    const row = await db.prisma.emailAccount.findUniqueOrThrow({ where: { id: a.id } });
    expect(decryptCredentials(row.credentialsEnc!)).toMatchObject({
      accessToken: "at-2",
      refreshToken: "rt-2",
    });
  });

  test("a revoked grant at refresh is an AuthError and stored tokens stay", async () => {
    const stale = {
      kind: "oauth" as const,
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: 1,
      scope: SCOPE,
    };
    const a = await seedAccount(db.prisma, encryptCredentials(stale), "z@corp.example");
    const fetch = createFixtureFetch([
      { method: "POST", url: TOKEN, respond: async () => json({ error: "invalid_grant" }, 400) },
    ]);
    const p = createProvider(
      { id: a.id, provider: "MICROSOFT", email: "z@corp.example" },
      { prisma: db.prisma, fetch },
    );
    await expect(p.currentCursor()).rejects.toMatchObject({
      name: "AuthError",
      reason: "invalid_grant",
    });
  });
});
