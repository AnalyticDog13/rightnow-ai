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
let writeKey: string;
let stages: typeof import("../app/api/v1/crm/stages/route");
let stage: typeof import("../app/api/v1/crm/stages/[id]/route");
let opps: typeof import("../app/api/v1/crm/opportunities/route");
let opp: typeof import("../app/api/v1/crm/opportunities/[id]/route");
let settings: typeof import("../app/api/v1/settings/workspace/route");
let merge: typeof import("../app/api/v1/leads/merge/route");

const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });
const req = (
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = { cookie },
) =>
  new Request(`${ORIGIN}/api/v1/${url}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
let n = 0;
const lead = (ws = workspaceId) =>
  db.prisma.lead.create({ data: { workspaceId: ws, email: `l${++n}@acme.io` } });

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
  stages = await import("../app/api/v1/crm/stages/route");
  stage = await import("../app/api/v1/crm/stages/[id]/route");
  opps = await import("../app/api/v1/crm/opportunities/route");
  opp = await import("../app/api/v1/crm/opportunities/[id]/route");
  settings = await import("../app/api/v1/settings/workspace/route");
  merge = await import("../app/api/v1/leads/merge/route");
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
  readKey = (await createApiKey(db.prisma, workspaceId, "r", ["crm:read"])).token;
  writeKey = (await createApiKey(db.prisma, workspaceId, "w", ["crm:write", "all:all"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("crm routes", () => {
  it("stages: GET seeds the defaults; configuration is ADMIN and session-only", async () => {
    const r = await json(await stages.GET(req("GET", "crm/stages")));
    const list = r.stages as { id: string; name: string }[];
    expect(list).toHaveLength(9);
    const id = list[5]!.id;
    expect((await stages.GET(req("GET", "crm/stages", undefined, bearer(readKey)))).status).toBe(
      200,
    );
    for (const h of [bearer(writeKey)]) {
      expect(
        (await stages.POST(req("POST", "crm/stages", { name: "K", kind: "OPEN" }, h))).status,
      ).toBe(403);
      expect(
        (await stage.PATCH(req("PATCH", `crm/stages/${id}`, { name: "K" }, h), p(id))).status,
      ).toBe(403);
      expect(
        (await stage.DELETE(req("DELETE", `crm/stages/${id}`, undefined, h), p(id))).status,
      ).toBe(403);
    }
    await setRole("member");
    expect((await stages.POST(req("POST", "crm/stages", { name: "K", kind: "OPEN" }))).status).toBe(
      403,
    );
    expect((await stage.PATCH(req("PATCH", `crm/stages/${id}`, { name: "K" }), p(id))).status).toBe(
      403,
    );
    expect((await stage.DELETE(req("DELETE", `crm/stages/${id}`), p(id))).status).toBe(403);
    await setRole("owner");
    const created = await stages.POST(req("POST", "crm/stages", { name: "Demo", kind: "OPEN" }));
    expect(created.status).toBe(200);
    const sid = ((await json(created)) as { id: string }).id;
    expect(
      (await stage.PATCH(req("PATCH", `crm/stages/${sid}`, { position: 0 }), p(sid))).status,
    ).toBe(200);
    const moveTo = list[1]!.id;
    const del = await stage.DELETE(req("DELETE", `crm/stages/${sid}?moveTo=${moveTo}`), p(sid));
    expect(await json(del)).toEqual({ moved: 0 });
  });

  it("opportunities: scopes, validation and conflicts", async () => {
    const l = await lead();
    const camp = await db.prisma.campaign.create({ data: { workspaceId, name: "C" } });
    expect(
      (await opps.GET(req("GET", "crm/opportunities", undefined, bearer(readKey)))).status,
    ).toBe(200);
    expect(
      (await opps.POST(req("POST", "crm/opportunities", { leadId: l.id }, bearer(readKey)))).status,
    ).toBe(403);
    for (const value of [-1, 1e13])
      expect(
        (await opps.POST(req("POST", "crm/opportunities", { leadId: l.id, value }))).status,
      ).toBe(400);
    expect(
      (await opps.POST(req("POST", "crm/opportunities", { leadId: l.id, ownerId: "nobody" })))
        .status,
    ).toBe(400);
    const body = { leadId: l.id, campaignId: camp.id, value: 99.5 };
    const ok = await opps.POST(req("POST", "crm/opportunities", body, bearer(writeKey)));
    expect(ok.status).toBe(200);
    const o = (await json(ok)) as { id: string; value: string; lead: { email: string } };
    expect(o).toMatchObject({ value: "99.50", lead: { email: l.email } });
    const dup = await opps.POST(req("POST", "crm/opportunities", body));
    expect(dup.status).toBe(409);
    expect(await json(dup)).toEqual({ error: "opportunity_exists" });
    expect((await opp.GET(req("GET", `crm/opportunities/${o.id}`), p(o.id))).status).toBe(200);
    const pat = await opp.PATCH(
      req("PATCH", `crm/opportunities/${o.id}`, { value: 1e13 }),
      p(o.id),
    );
    expect(pat.status).toBe(400);
    const board = await json(await opps.GET(req("GET", "crm/opportunities?view=board")));
    expect(board).toMatchObject({ currency: "USD" });

    // merge clash: 409 with the campaign id
    const l2 = await lead();
    await opps.POST(req("POST", "crm/opportunities", { leadId: l2.id, campaignId: camp.id }));
    const mr = await merge.POST(req("POST", "leads/merge", { keepId: l.id, mergeId: l2.id }));
    expect(mr.status).toBe(409);
    expect(await json(mr)).toEqual({ error: "opportunity_conflict", campaignId: camp.id });

    expect(
      (await settings.PATCH(req("PATCH", "settings/workspace", { currency: "usd" }))).status,
    ).toBe(400);
    expect(
      (await settings.PATCH(req("PATCH", "settings/workspace", { currency: "EUR" }))).status,
    ).toBe(409);
    expect((await opp.DELETE(req("DELETE", `crm/opportunities/${o.id}`), p(o.id))).status).toBe(
      200,
    );
    expect((await opp.GET(req("GET", `crm/opportunities/${o.id}`), p(o.id))).status).toBe(404);
  });

  it("every route is workspace-scoped", async () => {
    const { ensureStages, listOpportunities, pipelineBoard } = await import("@rightnow/core");
    const other = await db.prisma.workspace.create({ data: { name: "X", slug: "x-crm" } });
    const foreign = await lead(other.id);
    const fs = await ensureStages(db.prisma, other.id);
    const fo = await db.prisma.opportunity.create({
      data: { workspaceId: other.id, leadId: foreign.id, stageId: fs[0]!.id, title: "t" },
    });
    expect((await opp.GET(req("GET", `crm/opportunities/${fo.id}`), p(fo.id))).status).toBe(404);
    expect(
      (await opp.PATCH(req("PATCH", `crm/opportunities/${fo.id}`, { title: "x" }), p(fo.id)))
        .status,
    ).toBe(404);
    expect((await opp.DELETE(req("DELETE", `crm/opportunities/${fo.id}`), p(fo.id))).status).toBe(
      404,
    );
    const sid = fs[1]!.id;
    expect(
      (await stage.PATCH(req("PATCH", `crm/stages/${sid}`, { name: "x" }), p(sid))).status,
    ).toBe(404);
    expect((await stage.DELETE(req("DELETE", `crm/stages/${sid}`), p(sid))).status).toBe(404);
    expect((await opps.POST(req("POST", "crm/opportunities", { leadId: foreign.id }))).status).toBe(
      404,
    );
    const mine = (await json(await opps.GET(req("GET", "crm/opportunities")))).opportunities as {
      id: string;
    }[];
    expect(mine.map((o) => o.id)).not.toContain(fo.id);

    await expectIsolated({
      prisma: db.prisma,
      seed: async (ws) => {
        const s = await ensureStages(db.prisma, ws);
        const l = await lead(ws);
        await db.prisma.opportunity.create({
          data: { workspaceId: ws, leadId: l.id, stageId: s[0]!.id, title: "t" },
        });
      },
      read: async (ws) => [
        ...(await listOpportunities(db.prisma, ws, {})).opportunities,
        ...(await pipelineBoard(db.prisma, ws, {})).stages.flatMap((s) => s.opportunities),
      ],
    });
  });
});
