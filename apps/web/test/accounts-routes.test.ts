import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let accountId: string;
let foreignId: string;
let readKey: string;
let list: typeof import("../app/api/v1/accounts/route");
let one: typeof import("../app/api/v1/accounts/[id]/route");
let pause: typeof import("../app/api/v1/accounts/[id]/pause/route");
let bulk: typeof import("../app/api/v1/accounts/bulk/route");
let testConn: typeof import("../app/api/v1/accounts/test-connection/route");

const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });
const req = (
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = { cookie },
) =>
  new Request(`${ORIGIN}${url}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown, headers?: Record<string, string>) =>
  one.PATCH(req("PATCH", `/api/v1/accounts/${id}`, body, headers), p(id));

const mk = (workspaceId: string, email: string) =>
  db.prisma.emailAccount.create({
    data: {
      workspaceId,
      provider: "GMAIL",
      email,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: "GMAIL_WORKSPACE",
      providerCap: 1500,
    },
  });

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local",
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-web-")),
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
  });
  const { auth } = await import("../lib/auth");
  const { createApiKey } = await import("@rightnow/core");
  list = await import("../app/api/v1/accounts/route");
  one = await import("../app/api/v1/accounts/[id]/route");
  pause = await import("../app/api/v1/accounts/[id]/pause/route");
  bulk = await import("../app/api/v1/accounts/bulk/route");
  testConn = await import("../app/api/v1/accounts/test-connection/route");
  ({ workspaceId } = await createFirstOwner(
    db.prisma,
    { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
    TOKEN,
  ));
  const { headers } = await auth.api.signInEmail({
    body: { email: "owner@x.io", password: PASSWORD },
    returnHeaders: true,
  });
  cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  accountId = (await mk(workspaceId, "mine@acme.io")).id;
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  foreignId = (await mk(other.id, "theirs@acme.io")).id;
  readKey = (await createApiKey(db.prisma, workspaceId, "k", ["accounts:read"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("accounts routes", () => {
  it("lists and reads only this workspace's accounts, never credentials", async () => {
    const res = await list.GET(req("GET", "/api/v1/accounts"));
    const j = (await res.json()) as { accounts: { id: string }[] };
    expect(j.accounts.map((a) => a.id)).toEqual([accountId]);
    expect(JSON.stringify(j)).not.toContain("credentialsEnc");
    expect((await one.GET(req("GET", `/api/v1/accounts/${accountId}`), p(accountId))).status).toBe(
      200,
    );
    expect((await one.GET(req("GET", `/api/v1/accounts/${foreignId}`), p(foreignId))).status).toBe(
      404,
    );
    expect((await patch(foreignId, { fromName: "x" })).status).toBe(404);
  });

  it("an accounts:read key can GET but not PATCH", async () => {
    const h = { authorization: `Bearer ${readKey}` };
    expect((await list.GET(req("GET", "/api/v1/accounts", undefined, h))).status).toBe(200);
    expect((await patch(accountId, { fromName: "x" }, h)).status).toBe(403);
  });

  it("a VIEWER cannot PATCH; a MEMBER cannot delete or bulk delete", async () => {
    await setRole("viewer");
    expect((await patch(accountId, { fromName: "x" })).status).toBe(403);
    await setRole("member");
    expect(
      (await one.DELETE(req("DELETE", `/api/v1/accounts/${accountId}`), p(accountId))).status,
    ).toBe(403);
    const del = await bulk.POST(
      req("POST", "/api/v1/accounts/bulk", { ids: [accountId], action: "delete" }),
    );
    expect(del.status).toBe(403);
    expect((await patch(accountId, { fromName: "Member Edit" })).status).toBe(200);
    await setRole("owner");
  });

  it("unknown body property is 400; limits clamp with a warning", async () => {
    expect((await patch(accountId, { credentialsEnc: "x" })).status).toBe(400);
    const res = await patch(accountId, { dailyLimit: 99999 });
    const j = (await res.json()) as { account: { dailyLimit: number }; warnings: unknown[] };
    expect(j.account.dailyLimit).toBe(750);
    expect(j.warnings).toEqual([{ field: "dailyLimit", clampedTo: 750, reason: "provider_cap" }]);
  });

  it("pause then bulk resume", async () => {
    const r = await pause.POST(
      req("POST", `/api/v1/accounts/${accountId}/pause`, {}),
      p(accountId),
    );
    expect(((await r.json()) as { displayStatus: string }).displayStatus).toBe("PAUSED");
    const b = await bulk.POST(
      req("POST", "/api/v1/accounts/bulk", { ids: [accountId, foreignId], action: "resume" }),
    );
    expect(await b.json()).toEqual({
      results: [
        { id: accountId, ok: true },
        { id: foreignId, ok: false, error: "not_found" },
      ],
    });
  });
});

describe("SMTP connect routes", () => {
  const srv = (host: string) => ({
    host,
    port: 993,
    secure: true,
    username: "ann@acme.io",
    password: "hunter2-secret",
  });
  const body = (host = "imap.acme.io", email = "ann@acme.io") => ({
    email,
    firstName: "Ann",
    lastName: "Lee",
    imap: srv(host),
    smtp: srv(host),
  });
  const create = (b: unknown, headers?: Record<string, string>) =>
    list.POST(req("POST", "/api/v1/accounts", b, headers));
  const check = (b: unknown) => testConn.POST(req("POST", "/api/v1/accounts/test-connection", b));

  it("a MEMBER or VIEWER cannot create or test (403); an ADMIN can", async () => {
    for (const role of ["viewer", "member"]) {
      await setRole(role);
      expect((await create(body())).status).toBe(403);
      expect((await check(body())).status).toBe(403);
    }
    await setRole("admin");
    expect((await check(body())).status).toBe(200);
    const res = await create(body());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text).account).toMatchObject({ provider: "SMTP", email: "ann@acme.io" });
    await setRole("owner");
  });

  it("test-connection reports failed checks without saving; a failing create answers 422 with the checks", async () => {
    const before = await db.prisma.emailAccount.count({ where: { workspaceId } });
    const t = await check(body("fail.acme.io", "other@acme.io"));
    const tj = (await t.json()) as { ok: boolean; checks: { ok: boolean }[] };
    expect(tj.ok).toBe(false);
    const c = await create(body("fail.acme.io", "other@acme.io"));
    expect(c.status).toBe(422);
    expect(((await c.json()) as { checks: unknown[] }).checks.length).toBeGreaterThan(0);
    expect(await db.prisma.emailAccount.count({ where: { workspaceId } })).toBe(before);
  });

  it("a duplicate answers 409 account_exists; an API key without accounts:create cannot connect", async () => {
    const dup = await create(body());
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe("account_exists");
    expect(
      (await create(body("imap.acme.io", "k@acme.io"), { authorization: `Bearer ${readKey}` }))
        .status,
    ).toBe(403);
  });

  it("credentials route: ADMIN only, same id, 422 on failing checks, 409 for an OAuth account, audited", async () => {
    const cred = await import("../app/api/v1/accounts/[id]/credentials/route");
    const id = (
      await db.prisma.emailAccount.findFirstOrThrow({
        where: { workspaceId, email: "ann@acme.io" },
      })
    ).id;
    const post = (aid: string, host: string) =>
      cred.POST(
        req("POST", `/api/v1/accounts/${aid}/credentials`, { imap: srv(host), smtp: srv(host) }),
        p(aid),
      );
    await setRole("member");
    expect((await post(id, "imap.acme.io")).status).toBe(403);
    await setRole("admin");
    expect((await post(id, "fail.acme.io")).status).toBe(422);
    const ok = await post(id, "imap2.acme.io");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { account: { id: string } }).account.id).toBe(id);
    expect((await post(accountId, "imap.acme.io")).status).toBe(409); // a Gmail account
    expect((await post(foreignId, "imap.acme.io")).status).toBe(404);
    expect(
      await db.prisma.auditLog.count({
        where: { workspaceId, action: "account.reconnect", target: id },
      }),
    ).toBe(1);
    await setRole("owner");
  });

  it("rejects unknown properties and bad ports", async () => {
    expect((await create({ ...body(), credentialsEnc: "x" })).status).toBe(400);
    expect((await create({ ...body(), imap: { ...srv("a.io"), port: 70000 } })).status).toBe(400);
  });
});

describe("test-send and the fake mailbox route", () => {
  it("test-send: MEMBER 403, foreign account 404, bad body 400", async () => {
    const [ts, box] = await Promise.all([
      import("../app/api/v1/accounts/[id]/test-send/route"),
      import("../app/api/v1/%5Ffake/mailbox/[address]/route"),
    ]);
    const body = { to: "me@dest.example", confirmAuthorized: true };
    const send = (id: string) =>
      ts.POST(req("POST", `/api/v1/accounts/${id}/test-send`, body), p(id));
    await setRole("member");
    expect((await send(accountId)).status).toBe(403);
    await setRole("owner");
    expect((await send(foreignId)).status).toBe(404);
    const bad = await ts.POST(
      req("POST", `/api/v1/accounts/${accountId}/test-send`, {}),
      p(accountId),
    );
    expect(bad.status).toBe(400);

    const get = () =>
      box.GET(req("GET", "/api/v1/%5Ffake/mailbox/mine@acme.io"), {
        params: Promise.resolve({ address: "mine@acme.io" }),
      });
    expect((await get()).status).toBe(200);
    const { resetEnvCache } = await import("@rightnow/core");
    delete process.env.MAIL_PROVIDER_FAKE;
    resetEnvCache();
    try {
      expect((await get()).status).toBe(404);
    } finally {
      process.env.MAIL_PROVIDER_FAKE = "1";
      resetEnvCache();
    }
  });
});

describe("test-send rate limit over HTTP", () => {
  it("the 6th send is 429 with a Retry-After header and retryAfterSec", async () => {
    const { encryptCredentials } = await import("@rightnow/core");
    const ts = await import("../app/api/v1/accounts/[id]/test-send/route");
    const a = await db.prisma.emailAccount.create({
      data: {
        workspaceId,
        provider: "GMAIL",
        email: "limit@acme.io",
        fromName: "F",
        firstName: "F",
        lastName: "L",
        capTier: "GMAIL_WORKSPACE",
        providerCap: 1500,
        credentialsEnc: encryptCredentials({
          kind: "oauth",
          accessToken: "a",
          refreshToken: "r",
          expiresAt: 1,
          scope: "s",
        }),
      },
    });
    const send = () =>
      ts.POST(
        req("POST", `/api/v1/accounts/${a.id}/test-send`, {
          to: "me@dest.example",
          confirmAuthorized: true,
        }),
        p(a.id),
      );
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(200);
    const res = await send();
    expect(res.status).toBe(429);
    const sec = ((await res.json()) as { retryAfterSec: number }).retryAfterSec;
    expect(sec).toBeGreaterThan(0);
    expect(res.headers.get("retry-after")).toBe(String(sec));
  });
});
