import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

// No network in tests: SPF present (a pass), the rest missing (warnings, never a block)
vi.mock("../lib/dns", async () => {
  const { fakeResolver } = await import("../../../packages/core/test/dns-fixture");
  return {
    resolver: fakeResolver({
      "acme.io/TXT": [["v=spf1 include:_spf.google.com ~all"]],
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
let foreignId: string;
let key: string;
let rewarm: typeof import("../app/api/v1/accounts/[id]/rewarm/route");

const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });
const req = (method: string, body?: unknown, headers: Record<string, string> = { cookie }) =>
  new Request(`${ORIGIN}/x`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const start = (id: string, body: unknown = {}, h?: Record<string, string>) =>
  rewarm.POST(req("POST", body, h), p(id));
const cancel = (id: string, h?: Record<string, string>) =>
  rewarm.DELETE(req("DELETE", undefined, h), p(id));

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
  rewarm = await import("../app/api/v1/accounts/[id]/rewarm/route");
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
  const mk = async (ws: string, email: string) =>
    (
      await db.prisma.emailAccount.create({
        data: {
          workspaceId: ws,
          provider: "GMAIL",
          email,
          fromName: "F",
          firstName: "F",
          lastName: "L",
          capTier: "GMAIL_WORKSPACE",
          providerCap: 1500,
          lifecycle: "INACTIVE",
          credentialsEnc: encryptCredentials({
            kind: "oauth",
            accessToken: "a",
            refreshToken: "r",
            expiresAt: Date.now() + 3600_000,
            scope: "s",
          }),
        },
      })
    ).id;
  accountId = await mk(workspaceId, "me@acme.io");
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  foreignId = await mk(other.id, "them@acme.io");
  key = (await createApiKey(db.prisma, workspaceId, "k", ["accounts:update"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("accounts/[id]/rewarm", () => {
  it("body bounds → 400", async () => {
    for (const body of [
      { startVolume: 0 },
      { startVolume: 51 },
      { incrementPerDay: 0 },
      { incrementPerDay: 21 },
      { withWarmup: "yes" },
      { other: 1 },
    ])
      expect((await start(accountId, body)).status).toBe(400);
  });

  it("VIEWER → 403; another workspace's account → 404", async () => {
    await setRole("VIEWER");
    expect((await start(accountId)).status).toBe(403);
    expect((await cancel(accountId)).status).toBe(403);
    await setRole("OWNER");
    expect((await start(foreignId)).status).toBe(404);
    expect((await cancel(foreignId)).status).toBe(404);
    expect(
      (await db.prisma.emailAccount.findUniqueOrThrow({ where: { id: foreignId } })).lifecycle,
    ).toBe("INACTIVE");
  });

  it("MEMBER starts (plan view and DNS warnings) and cancels; an API key may too", async () => {
    await setRole("MEMBER");
    const r = await start(accountId, { startVolume: 4, incrementPerDay: 3 });
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      account: { lifecycle: string; rewarm: { allowance: number; target: number; label: string } };
      warnings: { level: string }[];
    };
    expect(j.account.lifecycle).toBe("REWARMING");
    expect(j.account.rewarm).toMatchObject({ allowance: 4, target: 30 });
    expect(j.warnings.length).toBeGreaterThan(0);
    expect((await start(accountId)).status).toBe(409);
    const c = await cancel(accountId);
    expect(c.status).toBe(200);
    expect(
      ((await c.json()) as { account: { lifecycle: string; rewarm: null } }).account,
    ).toMatchObject({
      lifecycle: "ACTIVE",
      rewarm: null,
    });
    expect((await cancel(accountId)).status).toBe(409);
    await setRole("OWNER");
    const auth = { authorization: `Bearer ${key}` };
    expect((await start(accountId, {}, auth)).status).toBe(200);
    expect((await cancel(accountId, auth)).status).toBe(200);
  });
});
