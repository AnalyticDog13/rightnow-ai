import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, expectIsolated } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

// No network in tests: every route resolves DNS through lib/dns, replaced here by an in-memory resolver.
vi.mock("../lib/dns", async () => {
  const { fakeResolver } = await import("../../../packages/core/test/dns-fixture");
  const spf = [["v=spf1 include:_spf.google.com ~all"]];
  return {
    resolver: fakeResolver({
      "acme.io/TXT": spf,
      "acme.io/MX": { mx: [{ exchange: "mx.acme.io", priority: 1 }] },
      "_spf.google.com": [["v=spf1 ip4:35.190.247.0/24 -all"]],
    }),
  };
});

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let accountId: string;
let readKey: string;
let list: typeof import("../app/api/v1/domains/route");
let one: typeof import("../app/api/v1/domains/[domain]/route");
let check: typeof import("../app/api/v1/domains/[domain]/check/route");
let diag: typeof import("../app/api/v1/accounts/[id]/diagnostics/route");

const req = (method: string, body?: unknown, headers: Record<string, string> = { cookie }) =>
  new Request(`${ORIGIN}/x`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const mk = (ws: string, email: string, extra = {}) =>
  db.prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "GMAIL",
      email,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: "GMAIL_WORKSPACE",
      providerCap: 1500,
      ...extra,
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
  const { createApiKey, encryptCredentials } = await import("@rightnow/core");
  list = await import("../app/api/v1/domains/route");
  one = await import("../app/api/v1/domains/[domain]/route");
  check = await import("../app/api/v1/domains/[domain]/check/route");
  diag = await import("../app/api/v1/accounts/[id]/diagnostics/route");
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
  accountId = (
    await mk(workspaceId, "me@acme.io", {
      credentialsEnc: encryptCredentials({
        kind: "oauth",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 3600_000,
        scope: "s",
      }),
    })
  ).id;
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  await mk(other.id, "them@theirs.io");
  await db.prisma.domainCheck.create({
    data: {
      workspaceId: other.id,
      domain: "theirs.io",
      level: "ok",
      report: {},
      checkedAt: new Date(),
    },
  });
  readKey = (await createApiKey(db.prisma, workspaceId, "k", ["accounts:read"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("domains routes", () => {
  it("POST check runs fresh and stores the level; GET lists only this workspace", async () => {
    const { resolver } = await import("../lib/dns");
    const calls = (resolver as unknown as { calls: string[] }).calls;
    const res = await check.POST(req("POST", {}), p({ domain: "acme.io" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      report: { domain: "acme.io", spf: { status: "pass" } },
    });
    const n = calls.length;
    expect(n).toBeGreaterThan(0);
    await check.POST(req("POST", {}), p({ domain: "acme.io" }));
    expect(calls.length).toBe(2 * n); // never served from the cache

    const j = (await (await list.GET(req("GET"))).json()) as {
      domains: { domain: string; level: string }[];
    };
    expect(j.domains.map((d) => d.domain)).toEqual(["acme.io"]);
    expect(j.domains[0]!.level).toBe("warn"); // no DKIM, no DMARC
    expect(await db.prisma.auditLog.count({ where: { workspaceId, action: "domain.check" } })).toBe(
      2,
    );
  });

  it("another workspace's domain is 404 for check and PATCH, and it is not changed", async () => {
    expect((await check.POST(req("POST", {}), p({ domain: "theirs.io" }))).status).toBe(404);
    expect(
      (await one.PATCH(req("PATCH", { selectors: ["x"] }), p({ domain: "theirs.io" }))).status,
    ).toBe(404);
    expect((await check.POST(req("POST", {}), p({ domain: "nobody.io" }))).status).toBe(404);
    const row = await db.prisma.domainCheck.findFirstOrThrow({ where: { domain: "theirs.io" } });
    expect(row.selectors).toEqual([]);
  });

  it("PATCH validates selectors (^[a-z0-9._-]{1,63}$, at most 10) and re-checks with them", async () => {
    const patch = (selectors: unknown) =>
      one.PATCH(req("PATCH", { selectors }), p({ domain: "acme.io" }));
    expect((await patch(["Bad Name"])).status).toBe(400);
    expect((await patch(["a".repeat(64)])).status).toBe(400);
    expect((await patch(Array.from({ length: 11 }, (_, i) => `s${i}`))).status).toBe(400);
    expect((await patch(["ok", "my-key.1"])).status).toBe(200);
    const row = await db.prisma.domainCheck.findFirstOrThrow({
      where: { workspaceId, domain: "acme.io" },
    });
    expect(row.selectors).toEqual(["ok", "my-key.1"]);
    expect(JSON.stringify(row.report)).toContain("my-key.1");
  });

  it("an accounts:read key can list but not check", async () => {
    const h = { authorization: `Bearer ${readKey}` };
    expect((await list.GET(req("GET", undefined, h))).status).toBe(200);
    expect((await check.POST(req("POST", {}, h), p({ domain: "acme.io" }))).status).toBe(403);
  });

  it("diagnostics carries the DNS report and leaves the account status alone", async () => {
    const res = await diag.POST(req("POST", {}), p({ id: accountId }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { dns: { spf: { status: string } } | null };
    expect(j.dns?.spf.status).toBe("pass");
    const a = await db.prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(a.status).toBe("CONNECTED");
  });

  it("GET is workspace-scoped (expectIsolated)", async () => {
    const { listDomainChecks } = await import("@rightnow/core");
    await expectIsolated({
      prisma: db.prisma,
      seed: (ws) =>
        db.prisma.domainCheck.create({
          data: {
            workspaceId: ws,
            domain: "iso.test",
            level: "ok",
            report: {},
            checkedAt: new Date(),
          },
        }),
      read: (ws) => listDomainChecks(db.prisma, ws),
    });
  });
});
