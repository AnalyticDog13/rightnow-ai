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
let sender: string;
let theirTest: string;
let adminKey: string;
let list: typeof import("../app/api/v1/placement-tests/route");
let one: typeof import("../app/api/v1/placement-tests/[id]/route");

const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });
const req = (method: string, body?: unknown, headers: Record<string, string> = { cookie }) =>
  new Request(`${ORIGIN}/x`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const mk = (ws: string, email: string, extra = {}) =>
  db.prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: "SMTP",
      providerCap: 500,
      credentialsEnc: "x",
      lastSyncCompletedAt: new Date(),
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
  const { createApiKey } = await import("@rightnow/core");
  list = await import("../app/api/v1/placement-tests/route");
  one = await import("../app/api/v1/placement-tests/[id]/route");
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
  sender = (await mk(workspaceId, "s@acme.io")).id;
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  const theirs = await mk(other.id, "them@theirs.io");
  theirTest = (
    await db.prisma.placementTest.create({
      data: { workspaceId: other.id, accountId: theirs.id, subject: "secret" },
    })
  ).id;
  adminKey = (await createApiKey(db.prisma, workspaceId, "k", ["accounts:update", "accounts:read"]))
    .token;
});
afterAll(async () => {
  await db.drop();
});

describe("placement-test routes", () => {
  it("POST is ADMIN and session only: MEMBER and API keys get 403", async () => {
    await setRole("member");
    expect((await list.POST(req("POST", { accountId: sender }))).status).toBe(403);
    await setRole("owner");
    const key = { authorization: `Bearer ${adminKey}` };
    expect((await list.POST(req("POST", { accountId: sender }, key))).status).toBe(403);
    expect(await db.prisma.placementTest.count({ where: { workspaceId } })).toBe(0);
  });

  it("validates the body, 404s a foreign account, and 409s without seeds", async () => {
    for (const b of [{}, { accountId: sender, subject: "x" }, { accountId: sender, extra: 1 }])
      expect((await list.POST(req("POST", b))).status, JSON.stringify(b)).toBe(400);
    const theirAcct = (
      await db.prisma.placementTest.findUniqueOrThrow({ where: { id: theirTest } })
    ).accountId;
    expect((await list.POST(req("POST", { accountId: theirAcct }))).status).toBe(404);
    const none = await list.POST(req("POST", { accountId: sender, subject: "S", body: "B" }));
    expect(none.status).toBe(409);
    expect(((await none.json()) as { error: string }).error).toBe("no_seeds");
  });

  it("starts a test with opted-in seeds; GET lists and reads it, audited", async () => {
    await mk(workspaceId, "seed@acme2.io", { placementSeed: true });
    const res = await list.POST(req("POST", { accountId: sender, subject: "S", body: "B" }));
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const rep = (await (await one.GET(req("GET"), p(id))).json()) as {
      seeds: { email: string; folder: string }[];
      spamAssassin: string;
    };
    expect(rep.seeds).toMatchObject([{ email: "seed@acme2.io", folder: "PENDING" }]);
    expect(rep.spamAssassin).toBe("not provided");
    const all = (await (await list.GET(req("GET"))).json()) as { tests: { id: string }[] };
    expect(all.tests.map((t) => t.id)).toEqual([id]);
    expect(
      await db.prisma.auditLog.count({ where: { workspaceId, action: "placement.start" } }),
    ).toBe(1);
  });

  it("GET is isolated by workspace and readable with accounts:read", async () => {
    expect((await one.GET(req("GET"), p(theirTest))).status).toBe(404);
    const key = { authorization: `Bearer ${adminKey}` };
    expect((await list.GET(req("GET", undefined, key))).status).toBe(200);
  });
});

describe("account PATCH placementSeed", () => {
  it("persists the opt-in and rejects a non-boolean", async () => {
    const acct = await import("../app/api/v1/accounts/[id]/route");
    const id = (await mk(workspaceId, "opt@acme3.io")).id;
    const bad = await acct.PATCH(req("PATCH", { placementSeed: "yes" }), p(id));
    expect(bad.status).toBe(400);
    const ok = await acct.PATCH(req("PATCH", { placementSeed: true }), p(id));
    expect(ok.status).toBe(200);
    expect((await db.prisma.emailAccount.findUniqueOrThrow({ where: { id } })).placementSeed).toBe(
      true,
    );
  });
});
