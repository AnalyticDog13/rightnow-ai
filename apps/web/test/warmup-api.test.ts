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
let ids: string[];
let theirs: string;
let readKey: string;
let warm: typeof import("../app/api/v1/accounts/[id]/warmup/route");
let stats: typeof import("../app/api/v1/accounts/[id]/warmup/stats/route");
let bulk: typeof import("../app/api/v1/accounts/bulk/route");

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
      ...extra,
    },
  });
const patch = (body: unknown, id = ids[0]!) => warm.PATCH(req("PATCH", body), p(id));

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
  warm = await import("../app/api/v1/accounts/[id]/warmup/route");
  stats = await import("../app/api/v1/accounts/[id]/warmup/stats/route");
  bulk = await import("../app/api/v1/accounts/bulk/route");
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
  ids = (await Promise.all(["a", "b", "c"].map((x) => mk(workspaceId, `${x}@acme${x}.io`)))).map(
    (a) => a.id,
  );
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  theirs = (await mk(other.id, "them@theirs.io")).id;
  readKey = (await createApiKey(db.prisma, workspaceId, "k", ["accounts:read"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("warm-up routes", () => {
  it("GET returns the defaults and PAUSED before anything is saved", async () => {
    const res = await warm.GET(req("GET"), p(ids[0]!));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: "PAUSED",
      peers: 0,
      settings: { enabled: false, dailyLimit: 10, replyRatePct: 30, filterTag: null },
    });
  });

  it("PATCH validates every bound with a 400 and saves nothing", async () => {
    const bad: unknown[] = [
      { dailyLimit: 0 },
      { dailyLimit: 51 },
      { increasePerDay: 5 },
      { increasePerDay: -1 },
      { replyRatePct: 101 },
      { replyRatePct: -1 },
      { filterTag: "ab" },
      { filterTag: "has space" },
      { filterTag: "a".repeat(25) },
      {
        customCurve: [
          { day: 3, volume: 1 },
          { day: 3, volume: 2 },
        ],
      },
      {
        customCurve: [
          { day: 3, volume: 1 },
          { day: 1, volume: 2 },
        ],
      },
      { customCurve: [{ day: 0, volume: 51 }] },
      { customCurve: [{ day: 0, volume: -1 }] },
      { customCurve: Array.from({ length: 91 }, (_, i) => ({ day: i, volume: 1 })) },
      { unknown: 1 },
    ];
    for (const b of bad) expect((await patch(b)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    expect(await db.prisma.warmupSettings.count({ where: { workspaceId } })).toBe(0);
  });

  it("PATCH saves, enables, audits, and warns about no slow ramp on a new account", async () => {
    const res = await patch({
      enabled: true,
      slowWarmup: false,
      customCurve: [
        { day: 0, volume: 2 },
        { day: 3, volume: 8 },
      ],
      filterTag: "My-Tag-1",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      warnings: ["slow_warmup_off_new_account"],
      settings: { enabled: true, filterTag: "My-Tag-1" },
      state: "PLACEMENT_UNKNOWN", // no peer yet
    });
    expect(
      await db.prisma.auditLog.count({ where: { workspaceId, action: "account.warmup_update" } }),
    ).toBe(1);
    const again = (await (await patch({ slowWarmup: true, customCurve: null })).json()) as {
      warnings: string[];
    };
    expect(again.warnings).toEqual([]);
    const row = await db.prisma.warmupSettings.findUniqueOrThrow({ where: { accountId: ids[0]! } });
    expect(row.customCurve).toBeNull();
  });

  it("bulk warmup_enable creates settings with distinct filterTags; warmup_disable switches them off", async () => {
    const res = await bulk.POST(req("POST", { ids, action: "warmup_enable" }));
    expect(res.status).toBe(200);
    const rows = await db.prisma.warmupSettings.findMany({ where: { workspaceId } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.enabled && r.startedAt)).toBe(true);
    expect(new Set(rows.map((r) => r.filterTag)).size).toBe(3);
    expect(
      rows.filter((r) => r.accountId !== ids[0]).every((r) => /^rn-[0-9a-f]{6}$/.test(r.filterTag)),
    ).toBe(true);
    const peers = await (await warm.GET(req("GET"), p(ids[1]!))).json();
    expect(peers).toMatchObject({ state: "ACTIVE", peers: 2 });
    await bulk.POST(req("POST", { ids, action: "warmup_disable" }));
    const off = await db.prisma.warmupSettings.findMany({ where: { workspaceId } });
    expect(off.every((r) => !r.enabled)).toBe(true);
  });

  it("stats returns 30 days with zeros filled", async () => {
    const res = await stats.GET(req("GET"), p(ids[0]!));
    const j = (await res.json()) as { days: { day: string; sent: number }[] };
    expect(j.days).toHaveLength(30);
    expect(j.days.every((d) => d.sent === 0)).toBe(true);
    const week = new Request(`${ORIGIN}/x?days=7`, { headers: { cookie } });
    expect(((await (await stats.GET(week, p(ids[0]!))).json()) as { days: [] }).days).toHaveLength(7);
  });

  it("another workspace's account is 404 on every route and is not changed", async () => {
    expect((await warm.GET(req("GET"), p(theirs))).status).toBe(404);
    expect((await patch({ enabled: true }, theirs)).status).toBe(404);
    expect((await stats.GET(req("GET"), p(theirs))).status).toBe(404);
    const r = (await (
      await bulk.POST(req("POST", { ids: [theirs], action: "warmup_enable" }))
    ).json()) as { results: { ok: boolean; error?: string }[] };
    expect(r.results).toEqual([{ id: theirs, ok: false, error: "not_found" }]);
    expect(await db.prisma.warmupSettings.count({ where: { accountId: theirs } })).toBe(0);
  });

  it("an accounts:read key can read but not change", async () => {
    const h = { authorization: `Bearer ${readKey}` };
    expect((await warm.GET(req("GET", undefined, h), p(ids[0]!))).status).toBe(200);
    expect((await stats.GET(req("GET", undefined, h), p(ids[0]!))).status).toBe(200);
    expect((await warm.PATCH(req("PATCH", { enabled: true }, h), p(ids[0]!))).status).toBe(403);
  });
});
