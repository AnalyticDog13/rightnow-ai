import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKey, fixedClock, revokeApiKey, verifyApiKey } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import { route } from "../lib/api";
import { apiKeyResolver } from "../lib/apikey-auth";
import { readiness } from "../lib/ready";

let db: Awaited<ReturnType<typeof createTestDb>>;
let w1: string;
let w2: string;
const none = async () => null;

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  db = await createTestDb();
  w1 = (await db.prisma.workspace.create({ data: { name: "A", slug: "a" } })).id;
  w2 = (await db.prisma.workspace.create({ data: { name: "B", slug: "b" } })).id;
});
afterAll(async () => {
  await db.drop();
});

describe("API keys", () => {
  it("token format, hash stored, verify returns scopes and sets lastUsedAt", async () => {
    const { id, token } = await createApiKey(db.prisma, w1, "k", ["leads:read"]);
    expect(token).toMatch(/^rn_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
    const row = await db.prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.prefix).toBe(token.split("_")[1]);
    expect(await verifyApiKey(db.prisma, token)).toEqual({
      workspaceId: w1,
      keyId: id,
      scopes: ["leads:read"],
    });
    expect((await db.prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt).not.toBeNull();
  });

  it("wrong secret, garbage and revoked keys -> null", async () => {
    const { id, token } = await createApiKey(db.prisma, w1, "k2", ["all:all"]);
    const wrong = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await verifyApiKey(db.prisma, wrong)).toBeNull();
    expect(await verifyApiKey(db.prisma, "nope")).toBeNull();
    expect(await revokeApiKey(db.prisma, w1, id)).toBe(true);
    expect(await verifyApiKey(db.prisma, token)).toBeNull();
  });

  it("another workspace cannot revoke a key", async () => {
    const { id, token } = await createApiKey(db.prisma, w1, "k3", ["all:all"]);
    expect(await revokeApiKey(db.prisma, w2, id)).toBe(false);
    expect(await verifyApiKey(db.prisma, token)).not.toBeNull();
  });
});

describe("route() with API keys", () => {
  const req = (token: string, method = "GET") =>
    new Request("http://x/api/t", { method, headers: { authorization: `Bearer ${token}` } });
  const mk = (scope?: string) =>
    route(
      { auth: "session-or-apikey", scope },
      async (c) => ({ w: c.workspaceId }),
      none,
      apiKeyResolver(db.prisma),
    );

  it("leads:read key -> GET ok, write 403; leads:all and all:all allow; no scope -> 403", async () => {
    const { token } = await createApiKey(db.prisma, w1, "r", ["leads:read"]);
    expect((await mk("leads:read")(req(token))).status).toBe(200);
    expect((await mk("leads:write")(req(token, "POST"))).status).toBe(403);
    expect((await mk("campaigns:read")(req(token))).status).toBe(403);
    const all = await createApiKey(db.prisma, w1, "l", ["leads:all"]);
    expect((await mk("leads:write")(req(all.token, "POST"))).status).toBe(200);
    const root = await createApiKey(db.prisma, w1, "root", ["all:all"]);
    const res = await mk("campaigns:write")(req(root.token, "POST"));
    expect([res.status, await res.json()]).toEqual([200, { w: w1 }]);
    expect((await mk()(req(root.token))).status).toBe(403);
  });

  it("bad / revoked / missing key -> 401; session-only routes ignore keys", async () => {
    const { id, token } = await createApiKey(db.prisma, w1, "rv", ["all:all"]);
    await revokeApiKey(db.prisma, w1, id);
    expect((await mk("leads:read")(req(token))).status).toBe(401);
    expect((await mk("leads:read")(new Request("http://x/"))).status).toBe(401);
    const live = await createApiKey(db.prisma, w1, "live", ["all:all"]);
    const sessionOnly = route({}, async () => ({}), none, apiKeyResolver(db.prisma));
    expect((await sessionOnly(req(live.token))).status).toBe(401);
  });
});

describe("readiness", () => {
  const clock = fixedClock(new Date("2026-01-01T00:00:00Z"));
  it("503 without a live worker, 200 with a fresh heartbeat, 503 when stale or stopped", async () => {
    const r = await readiness(db.prisma, clock);
    expect([r.ok, r.body.db, r.body.worker]).toEqual([false, true, false]);
    expect(r.body.sync).toEqual({ accountsTotal: 0, accountsFresh: 0 });
    const boot = await db.prisma.workerBoot.create({
      data: { hostname: "h", lastHeartbeatAt: new Date("2025-12-31T23:59:00Z") },
    });
    expect((await readiness(db.prisma, clock)).ok).toBe(true);
    await db.prisma.workerBoot.update({
      where: { id: boot.id },
      data: { lastHeartbeatAt: new Date("2025-12-31T23:57:00Z") },
    });
    expect((await readiness(db.prisma, clock)).ok).toBe(false);
    await db.prisma.workerBoot.update({
      where: { id: boot.id },
      data: { lastHeartbeatAt: new Date("2025-12-31T23:59:30Z"), stoppedAt: new Date() },
    });
    expect((await readiness(db.prisma, clock)).ok).toBe(false);
  });

  it("db down -> not ok, no internals leaked", async () => {
    const broken = {
      $queryRaw: async () => {
        throw new Error("password=secret host=10.0.0.1");
      },
    } as never;
    const r = await readiness(broken, clock);
    expect(r.ok).toBe(false);
    expect(r.body.db).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/secret|10\.0\.0\.1/);
  });
});
