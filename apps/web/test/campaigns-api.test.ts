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
  resume = await import("../app/api/v1/campaigns/[id]/resume/route");
  archive = await import("../app/api/v1/campaigns/[id]/archive/route");
  schedules = await import("../app/api/v1/campaigns/[id]/schedules/route");
  accounts = await import("../app/api/v1/campaigns/[id]/accounts/route");
  byAccount = await import("../app/api/v1/accounts/[id]/campaigns/route");
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
    expect(c).toMatchObject({ status: "DRAFT", minGapSec: 540, unsubscribeHeader: true });
    const off = { name: "B", unsubscribeHeader: false };
    expect((await list.POST(req("POST", "/api/v1/campaigns", off))).status).toBe(400);
    expect(
      (await list.POST(req("POST", "/api/v1/campaigns", { name: "B", extra: 1 }))).status,
    ).toBe(400);

    const patched = await one.PATCH(req("PATCH", "/x", { dailyLimit: 10 }), p(c.id));
    expect((await json(patched)).dailyLimit).toBe(10);

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
    expect((await json(await resume.POST(req("POST", "/x"), p(c.id)))).status).toBe("ACTIVE");
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
      await resume.POST(req("POST", "/x"), p(f)),
      await archive.POST(req("POST", "/x"), p(f)),
      await accounts.PUT(req("PUT", "/x", { accountIds: [] }), p(f)),
      await schedules.PUT(req("PUT", "/x", office), p(f)),
    ];
    expect(r.map((x) => x.status)).toEqual(Array(r.length).fill(404));
    const mine = (await json(await list.GET(req("GET", "/x")))).campaigns;
    expect(mine.map((x: any) => x.id)).not.toContain(f);
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
    await setRole("owner");
  });
});
