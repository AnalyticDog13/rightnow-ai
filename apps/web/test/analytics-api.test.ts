import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectIsolated } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let readKey: string;
let leadsKey: string;
let core: typeof import("@rightnow/core");
const routes = {} as {
  analytics: typeof import("../app/api/v1/analytics/route");
  accounts: typeof import("../app/api/v1/analytics/accounts/route");
  bounces: typeof import("../app/api/v1/analytics/bounces/route");
  crm: typeof import("../app/api/v1/analytics/crm/route");
  activity: typeof import("../app/api/v1/analytics/activity/route");
  dashboard: typeof import("../app/api/v1/dashboard/route");
};

const get = (url: string, headers: Record<string, string> = { cookie }) =>
  new Request(`${ORIGIN}/api/v1/${url}`, { headers: { origin: ORIGIN, ...headers } });
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const DAY = "from=2026-11-02&to=2026-11-02";
let n = 0;

/** A campaign named `name` with one accepted send (and a hard bounce) on 2026-11-02. */
async function seed(ws: string, name = `c${++n}`) {
  const P = db.prisma;
  const a = await P.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      capTier: "SMTP",
      providerCap: 100,
      email: `s${++n}@send.test`,
      fromName: "S",
      firstName: "S",
      lastName: "T",
    },
  });
  const c = await P.campaign.create({ data: { workspaceId: ws, name, status: "ACTIVE" } });
  const l = await P.lead.create({ data: { workspaceId: ws, email: `l${++n}@acme.io` } });
  const st = (await core.ensureStages(P, ws)).find((s) => s.kind === "WON")!;
  await P.opportunity.create({
    data: {
      workspaceId: ws,
      leadId: l.id,
      campaignId: c.id,
      stageId: st.id,
      title: "t",
      cashCollected: 5,
      closedAt: new Date("2026-11-02T12:00:00Z"),
    },
  });
  const ev = (type: "ACCEPTED" | "BOUNCE_HARD", meta = {}) => ({
    workspaceId: ws,
    type,
    occurredAt: new Date("2026-11-02T10:00:00Z"),
    leadId: l.id,
    campaignId: c.id,
    accountId: a.id,
    scheduledMessageId: `sm-${n}`,
    meta,
    dedupeKey: `${type}:${ws}:${++n}`,
  });
  await P.event.createMany({ data: [ev("ACCEPTED"), ev("BOUNCE_HARD", { reason: "gone" })] });
  return c;
}

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
  core = await import("@rightnow/core");
  routes.analytics = await import("../app/api/v1/analytics/route");
  routes.accounts = await import("../app/api/v1/analytics/accounts/route");
  routes.bounces = await import("../app/api/v1/analytics/bounces/route");
  routes.crm = await import("../app/api/v1/analytics/crm/route");
  routes.activity = await import("../app/api/v1/analytics/activity/route");
  routes.dashboard = await import("../app/api/v1/dashboard/route");
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
  readKey = (await core.createApiKey(db.prisma, workspaceId, "r", ["analytics:read"])).token;
  leadsKey = (await core.createApiKey(db.prisma, workspaceId, "l", ["leads:read"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("analytics routes", () => {
  it("scopes, validation, JSON and CSV", async () => {
    const mine = await seed(workspaceId, "=SUM(A1)");
    const foreign = await db.prisma.workspace.create({ data: { name: "F", slug: "f-analytics" } });
    const theirs = await seed(foreign.id);

    const all = [
      () => routes.analytics.GET(get(`analytics?${DAY}`, bearer(readKey))),
      () => routes.accounts.GET(get(`analytics/accounts?${DAY}`, bearer(readKey))),
      () => routes.bounces.GET(get(`analytics/bounces?${DAY}`, bearer(readKey))),
      () => routes.crm.GET(get(`analytics/crm?${DAY}`, bearer(readKey))),
      () => routes.activity.GET(get(`analytics/activity?${DAY}`, bearer(readKey))),
      () => routes.dashboard.GET(get("dashboard", bearer(readKey))),
    ];
    for (const call of all) expect((await call()).status).toBe(200);
    for (const [name, r] of Object.entries(routes)) {
      const url = name === "dashboard" ? "dashboard" : `analytics?${DAY}`;
      expect((await r.GET(get(url, bearer(leadsKey)))).status, name).toBe(403);
    }

    const byCampaign = (await (
      await routes.analytics.GET(get(`analytics?${DAY}&groupBy=campaign`))
    ).json()) as { total: { sent: number }; rows: { key: string }[] };
    expect(byCampaign.total.sent).toBe(1);
    expect(byCampaign.rows.map((r) => r.key)).toEqual([mine.id]);
    expect(byCampaign.rows.map((r) => r.key)).not.toContain(theirs.id);
    // A1: several groupings in one request, each equal to its own groupBy answer
    const groups = (await (
      await routes.analytics.GET(get(`analytics?${DAY}&groups=campaign,day,campaign`))
    ).json()) as Record<string, unknown>;
    expect(Object.keys(groups).sort()).toEqual(["campaign", "day"]);
    expect(groups.campaign).toEqual(byCampaign);
    expect((await routes.analytics.GET(get(`analytics?${DAY}&groups=list`))).status).toBe(400);
    expect((await routes.analytics.GET(get(`analytics?${DAY}&groups=day&format=csv`))).status).toBe(
      400,
    );

    for (const bad of [
      "from=2026-11-03&to=2026-11-02",
      "from=2026-11-02&to=2026-11-02&tz=Mars/Base",
      "from=2026-11-02&to=2026-11-02&groupBy=list",
      "from=2026-11-02",
    ])
      expect((await routes.analytics.GET(get(`analytics?${bad}`))).status, bad).toBe(400);
    // checked before the CSV stream starts
    expect((await routes.activity.GET(get(`analytics/activity?${DAY}&tz=Mars/Base`))).status).toBe(
      400,
    );

    const csv = await routes.analytics.GET(get(`analytics?${DAY}&groupBy=campaign&format=csv`));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = (await csv.text()).split("\r\n").filter(Boolean);
    expect(lines[0]!.startsWith("key,label,")).toBe(true);
    expect(lines).toHaveLength(1 + 1 + 1); // header, one group, total
    expect(lines[1]).toContain(`${mine.id},'=SUM(A1),1,`);

    const act = await routes.activity.GET(get(`analytics/activity?${DAY}`));
    expect(act.headers.get("content-disposition")).toContain("activity.csv");
    expect((await act.text()).split("\r\n").filter(Boolean)).toHaveLength(1 + 2);

    const dash = (await (await routes.dashboard.GET(get("dashboard"))).json()) as {
      campaigns: { id: string }[];
    };
    expect(dash.campaigns.map((c) => c.id)).toEqual([mine.id]);
  });

  it("isolation on all six routes", async () => {
    const q = core.analyticsQuery.parse({
      from: "2026-11-02",
      to: "2026-11-02",
      groupBy: "campaign",
    });
    const now = new Date("2026-11-02T12:00:00Z");
    const reads: ((ws: string) => Promise<unknown[]>)[] = [
      async (ws) => (await core.analytics(db.prisma, ws, q)).rows,
      async (ws) => (await core.accountAnalytics(db.prisma, ws, q, now)).filter((a) => a.sent > 0),
      async (ws) => (await core.bounceBreakdown(db.prisma, ws, q)).reasons,
      async (ws) => (await core.crmReport(db.prisma, ws, q)).revenueByCampaign,
      async (ws) => {
        const out: string[] = [];
        for await (const c of core.exportActivityCsv(db.prisma, ws, q)) out.push(c);
        return out.slice(1);
      },
      async (ws) => (await core.dashboardSummary(db.prisma, ws, now)).campaigns,
    ];
    for (const read of reads)
      await expectIsolated({ prisma: db.prisma, seed: (ws) => seed(ws), read });
  });
});
