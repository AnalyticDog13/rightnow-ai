import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

// The D17 test launches with the Fake switched off, which turns the DNS gate on: answer it from memory (no network).
vi.mock("../lib/dns", async () => {
  const { fakeResolver } = await import("../../../packages/core/test/dns-fixture");
  return {
    resolver: fakeResolver({
      "send.test/TXT": [["v=spf1 ip4:1.2.3.4 -all"]],
      "send.test/MX": { mx: [{ exchange: "mx.send.test", priority: 1 }] },
    }),
  };
});

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let foreign: { campaign: string; account: string };
let own: { account: string };
let list: typeof import("../app/api/v1/campaigns/route");
let one: typeof import("../app/api/v1/campaigns/[id]/route");
let launch: typeof import("../app/api/v1/campaigns/[id]/launch/route");
let pause: typeof import("../app/api/v1/campaigns/[id]/pause/route");
let resume: typeof import("../app/api/v1/campaigns/[id]/resume/route");
let archive: typeof import("../app/api/v1/campaigns/[id]/archive/route");
let schedules: typeof import("../app/api/v1/campaigns/[id]/schedules/route");
let accounts: typeof import("../app/api/v1/campaigns/[id]/accounts/route");
let byAccount: typeof import("../app/api/v1/accounts/[id]/campaigns/route");
let steps: typeof import("../app/api/v1/campaigns/[id]/steps/route");
let variants: typeof import("../app/api/v1/campaigns/[id]/steps/[stepId]/variants/route");
let enrollR: typeof import("../app/api/v1/campaigns/[id]/leads/route");
let clR: typeof import("../app/api/v1/campaigns/[id]/leads/[clId]/route");
let dup: typeof import("../app/api/v1/campaigns/[id]/duplicate/route");
let exp: typeof import("../app/api/v1/campaigns/[id]/export/route");
let status: typeof import("../app/api/v1/campaigns/[id]/status/route");
let imp: typeof import("../app/api/v1/campaigns/import/route");

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
/* eslint-disable @typescript-eslint/no-explicit-any -- test helper reads loose JSON */
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });
const mkAccount = (ws: string, email: string) =>
  db.prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: "SMTP",
      providerCap: 100,
    },
  });
const office = { schedules: [{ name: "o", days: 62, from: "09:00", to: "17:00" }] };

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
  list = await import("../app/api/v1/campaigns/route");
  one = await import("../app/api/v1/campaigns/[id]/route");
  launch = await import("../app/api/v1/campaigns/[id]/launch/route");
  pause = await import("../app/api/v1/campaigns/[id]/pause/route");
  status = await import("../app/api/v1/campaigns/[id]/status/route");
  resume = await import("../app/api/v1/campaigns/[id]/resume/route");
  archive = await import("../app/api/v1/campaigns/[id]/archive/route");
  schedules = await import("../app/api/v1/campaigns/[id]/schedules/route");
  accounts = await import("../app/api/v1/campaigns/[id]/accounts/route");
  byAccount = await import("../app/api/v1/accounts/[id]/campaigns/route");
  steps = await import("../app/api/v1/campaigns/[id]/steps/route");
  variants = await import("../app/api/v1/campaigns/[id]/steps/[stepId]/variants/route");
  enrollR = await import("../app/api/v1/campaigns/[id]/leads/route");
  clR = await import("../app/api/v1/campaigns/[id]/leads/[clId]/route");
  dup = await import("../app/api/v1/campaigns/[id]/duplicate/route");
  exp = await import("../app/api/v1/campaigns/[id]/export/route");
  imp = await import("../app/api/v1/campaigns/import/route");
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
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  foreign = {
    campaign: (await db.prisma.campaign.create({ data: { workspaceId: other.id, name: "F" } })).id,
    account: (await mkAccount(other.id, "f@send.test")).id,
  };
  own = { account: (await mkAccount(workspaceId, "m@send.test")).id };
});
afterAll(async () => {
  await db.drop();
});

describe("campaign routes", () => {
  it("create, get, patch, schedules, accounts, account view, status moves, delete", async () => {
    const c = await json(await list.POST(req("POST", "/api/v1/campaigns", { name: "A" })));
    expect(c).toMatchObject({
      status: "DRAFT",
      minGapSec: 540,
      unsubscribeHeader: true,
      unsubscribeLink: true,
      optOutText: null,
    });
    const off = { name: "B", unsubscribeHeader: false };
    expect((await list.POST(req("POST", "/api/v1/campaigns", off))).status).toBe(400);
    expect(
      (await list.POST(req("POST", "/api/v1/campaigns", { name: "B", extra: 1 }))).status,
    ).toBe(400);

    const patched = await one.PATCH(req("PATCH", "/x", { dailyLimit: 10 }), p(c.id));
    expect((await json(patched)).dailyLimit).toBe(10);

    const oo = await one.PATCH(
      req("PATCH", "/x", { unsubscribeLink: false, optOutText: " Reply stop " }),
      p(c.id),
    );
    expect(await json(oo)).toMatchObject({ unsubscribeLink: false, optOutText: "Reply stop" });
    const tooLong = { optOutText: "x".repeat(301) };
    expect((await one.PATCH(req("PATCH", "/x", tooLong), p(c.id))).status).toBe(400);

    const sch = await schedules.PUT(req("PUT", "/x", office), p(c.id));
    expect((await json(sch)).schedules[0]).toMatchObject({ days: 62, timezone: "UTC" });
    const zeroDays = { schedules: [{ name: "o", days: 0, from: "09:00", to: "17:00" }] };
    expect((await schedules.PUT(req("PUT", "/x", zeroDays), p(c.id))).status).toBe(400);

    const acc = (ids: string[]) => accounts.PUT(req("PUT", "/x", { accountIds: ids }), p(c.id));
    expect((await acc([foreign.account])).status).toBe(400);
    expect((await acc([own.account])).status).toBe(200);
    expect((await json(await byAccount.GET(req("GET", "/x"), p(own.account)))).campaigns).toEqual([
      { id: c.id, name: "A", status: "DRAFT" },
    ]);
    expect((await byAccount.GET(req("GET", "/x"), p(foreign.account))).status).toBe(404);

    expect((await json(await one.GET(req("GET", "/x"), p(c.id)))).accounts).toHaveLength(1);
    expect((await pause.POST(req("POST", "/x"), p(c.id))).status).toBe(409);
    const l = await launch.POST(req("POST", "/x", {}), p(c.id));
    expect(l.status).toBe(422);
    expect((await json(l)).issues.map((i: { code: string }) => i.code)).toContain("no_steps");
    const drafts = await list.GET(req("GET", "/api/v1/campaigns?status=DRAFT"));
    expect((await json(drafts)).campaigns).toHaveLength(1);

    await db.prisma.campaign.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    expect((await one.DELETE(req("DELETE", "/x"), p(c.id))).status).toBe(409);
    expect((await json(await pause.POST(req("POST", "/x"), p(c.id)))).status).toBe("PAUSED");
    // resume re-runs launch validation (no steps yet, so it stays paused)
    expect((await resume.POST(req("POST", "/x", {}), p(c.id))).status).toBe(422);
    await db.prisma.campaign.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    expect((await json(await archive.POST(req("POST", "/x"), p(c.id)))).status).toBe("ARCHIVED");
    expect((await one.DELETE(req("DELETE", "/x"), p(c.id))).status).toBe(200);
    expect((await one.GET(req("GET", "/x"), p(c.id))).status).toBe(404);
  });

  it("another workspace's campaign is 404 on every route", async () => {
    const f = foreign.campaign;
    const r = [
      await one.GET(req("GET", "/x"), p(f)),
      await one.PATCH(req("PATCH", "/x", { name: "z" }), p(f)),
      await one.DELETE(req("DELETE", "/x"), p(f)),
      await launch.POST(req("POST", "/x", {}), p(f)),
      await pause.POST(req("POST", "/x"), p(f)),
      await resume.POST(req("POST", "/x", {}), p(f)),
      await archive.POST(req("POST", "/x"), p(f)),
      await status.GET(req("GET", "/x"), p(f)),
      await accounts.PUT(req("PUT", "/x", { accountIds: [] }), p(f)),
      await schedules.PUT(req("PUT", "/x", office), p(f)),
    ];
    expect(r.map((x) => x.status)).toEqual(Array(r.length).fill(404));
    const mine = (await json(await list.GET(req("GET", "/x")))).campaigns;
    expect(mine.map((x: any) => x.id)).not.toContain(f);
  });

  it("sequence, enrollment, lead actions, duplicate, export and import", async () => {
    const c = await json(await list.POST(req("POST", "/x", { name: "Seq" })));
    const st = await json(await steps.POST(req("POST", "/x", { delayValue: 4 }), p(c.id)));
    expect(st).toMatchObject({ order: 1, delayValue: 0 });
    const sp = { params: Promise.resolve({ id: c.id, stepId: st.id }) };
    expect(
      (await variants.POST(req("POST", "/x", { subject: "{{nope}}", body: "b" }), sp)).status,
    ).toBe(400);
    const v = await variants.POST(
      req("POST", "/x", { subject: "Hi {{firstName}}", body: "b" }),
      sp,
    );
    expect(await json(v)).toMatchObject({ label: "A" });
    expect((await json(await steps.GET(req("GET", "/x"), p(c.id)))).steps[0].variants).toHaveLength(
      1,
    );

    const lead = await db.prisma.lead.create({ data: { workspaceId, email: "api@acme.test" } });
    const e = await json(await enrollR.POST(req("POST", "/x", { leadIds: [lead.id] }), p(c.id)));
    expect(e).toMatchObject({ enrolled: 1 });
    expect((await enrollR.POST(req("POST", "/x", {}), p(c.id))).status).toBe(400);
    expect((await json(await enrollR.GET(req("GET", "/x?status=Active"), p(c.id)))).total).toBe(1);
    const cl = await db.prisma.campaignLead.findFirstOrThrow({ where: { campaignId: c.id } });
    const act = (action: string) =>
      clR.POST(req("POST", "/x", { action }), {
        params: Promise.resolve({ id: c.id, clId: cl.id }),
      });
    expect((await json(await act("pause"))).campaignLead.state).toBe("PAUSED");
    expect((await json(await act("remove"))).campaignLead.stopReason).toBe("MANUAL");

    const doc = await json(await exp.GET(req("GET", "/x"), p(c.id)));
    expect(doc).toMatchObject({ version: 1, steps: [{ variants: [{ label: "A" }] }] });
    const copy = await json(await dup.POST(req("POST", "/x"), p(c.id)));
    expect(copy).toMatchObject({ name: "Seq (copy)", status: "DRAFT" });
    const imported = await json(await imp.POST(req("POST", "/x", doc)));
    expect(imported.status).toBe("DRAFT");
    expect((await imp.POST(req("POST", "/x", { ...doc, version: 9 }))).status).toBe(400);
    expect((await exp.GET(req("GET", "/x"), p(foreign.campaign))).status).toBe(404);
    expect(
      (await steps.POST(req("POST", "/x", { delayValue: 1 }), p(foreign.campaign))).status,
    ).toBe(404);
  });

  it("roles and API-key scopes", async () => {
    const { createApiKey } = await import("@rightnow/core");
    const read = (await createApiKey(db.prisma, workspaceId, "r", ["campaigns:read"])).token;
    const k = { authorization: `Bearer ${read}` };
    expect((await list.GET(req("GET", "/x", undefined, k))).status).toBe(200);
    expect((await list.POST(req("POST", "/x", { name: "K" }, k))).status).toBe(403);
    const write = (await createApiKey(db.prisma, workspaceId, "w", ["campaigns:write"])).token;
    const w = { authorization: `Bearer ${write}` };
    expect((await list.POST(req("POST", "/x", { name: "K" }, w))).status).toBe(200);
    await setRole("viewer");
    const c = await db.prisma.campaign.create({ data: { workspaceId, name: "V" } });
    expect((await launch.POST(req("POST", "/x", {}), p(c.id))).status).toBe(403);
    expect((await list.GET(req("GET", "/x"))).status).toBe(200);
    const sr = await status.GET(req("GET", "/x"), p(c.id)); // VIEWER may read the explainer
    expect(sr.status).toBe(200);
    expect(await json(sr)).toMatchObject({ sending: false, reasons: [{ code: "draft" }] });
    await setRole("owner");
  });
  it("launch reads sendable providers from ProviderVerification (D17), not the Fake stand-in", async () => {
    const P = db.prisma;
    await P.workspace.update({
      where: { id: workspaceId },
      data: { physicalAddress: "1 Main St" },
    });
    const c = await P.campaign.create({ data: { workspaceId, name: "D17" } });
    await P.campaignAccount.create({ data: { campaignId: c.id, accountId: own.account } });
    await P.campaignSchedule.create({
      data: { campaignId: c.id, name: "o", timezone: "UTC", days: 62, from: "09:00", to: "17:00" },
    });
    const st = await P.sequenceStep.create({ data: { campaignId: c.id, order: 1, delayValue: 0 } });
    await P.stepVariant.create({
      data: { stepId: st.id, label: "A", subject: "Hi", body: "Hello" },
    });
    const lead = await P.lead.create({ data: { workspaceId, email: "d17@lead.test" } });
    await P.campaignLead.create({ data: { workspaceId, campaignId: c.id, leadId: lead.id } });
    const { resetWebEnvCache } = await import("../lib/env");
    const codes = async () =>
      (
        await json(await launch.POST(req("POST", "/x", { overrideDnsWarnings: true }), p(c.id)))
      ).warnings.map((w: { code: string }) => w.code);
    delete process.env.MAIL_PROVIDER_FAKE;
    resetWebEnvCache();
    try {
      expect(await codes()).toContain("provider_not_verified");
      await P.providerVerification.create({
        data: { provider: "SMTP", passedAt: new Date(), accountId: own.account, report: {} },
      });
      expect(await codes()).not.toContain("provider_not_verified");
    } finally {
      process.env.MAIL_PROVIDER_FAKE = "1";
      resetWebEnvCache();
    }
  });
});
