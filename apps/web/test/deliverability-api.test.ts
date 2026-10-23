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
let cookie: string;
let readKey: string;
let wrongScopeKey: string;
let route: typeof import("../app/api/v1/deliverability/route");

const get = (headers: Record<string, string | undefined>) =>
  route.GET(new Request(`${ORIGIN}/x`, { headers: { origin: ORIGIN, ...headers } }), {
    params: Promise.resolve({}),
  });
const mk = (ws: string, email: string) =>
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
  route = await import("../app/api/v1/deliverability/route");
  const { workspaceId } = await createFirstOwner(
    db.prisma,
    { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
    TOKEN,
  );
  const { headers } = await auth.api.signInEmail({
    body: { email: "owner@x.io", password: PASSWORD },
    returnHeaders: true,
  });
  cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  await mk(workspaceId, "me@acme.io");
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  await mk(other.id, "them@theirs.io");
  readKey = (await createApiKey(db.prisma, workspaceId, "k", ["accounts:read"])).token;
  wrongScopeKey = (await createApiKey(db.prisma, workspaceId, "w", ["leads:read"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("GET /deliverability", () => {
  it("lists this workspace's accounts for a session and for an accounts:read key", async () => {
    for (const h of [{ cookie }, { authorization: `Bearer ${readKey}` }] as Record<
      string,
      string
    >[]) {
      const res = await get(h);
      expect(res.status).toBe(200);
      const j = (await res.json()) as { accounts: { email: string; status: string }[] };
      expect(j.accounts.map((a) => [a.email, a.status])).toEqual([["me@acme.io", "Active"]]);
    }
  });

  it("rejects no credentials and a key without accounts:read", async () => {
    expect((await get({})).status).toBe(401);
    expect((await get({ authorization: `Bearer ${wrongScopeKey}` })).status).toBe(403);
  });
});
