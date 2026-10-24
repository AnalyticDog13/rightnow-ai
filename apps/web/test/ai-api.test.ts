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
let settings: typeof import("../app/api/v1/settings/ai/route");
let list: typeof import("../app/api/v1/ai/suggestions/route");
let one: typeof import("../app/api/v1/ai/suggestions/[id]/route");
let feedback: typeof import("../app/api/v1/inbox/messages/[id]/ai-feedback/route");

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
const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted field by field
const json = async (res: Response) => (await res.json()) as Record<string, any>;
const CFG = { baseUrl: "https://93.184.216.34/v1", apiKey: "sk-secret-xyz", model: "gpt-x" };
const put = (b: unknown, h?: Record<string, string>) =>
  settings.PUT(req("PUT", "settings/ai", b, h));

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local",
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-web-ai-")),
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
  });
  const { auth } = await import("../lib/auth");
  settings = await import("../app/api/v1/settings/ai/route");
  list = await import("../app/api/v1/ai/suggestions/route");
  one = await import("../app/api/v1/ai/suggestions/[id]/route");
  feedback = await import("../app/api/v1/inbox/messages/[id]/ai-feedback/route");
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
});
afterAll(() => db.drop());

describe("settings/ai", () => {
  it("is ADMIN and session-only: MEMBER 403, an API key 401", async () => {
    const { createApiKey } = await import("@rightnow/core");
    const key = (await createApiKey(db.prisma, workspaceId, "all", ["all:all"])).token;
    const bearer = { authorization: `Bearer ${key}` };
    expect((await put(CFG, bearer)).status).toBe(401);
    expect((await settings.GET(req("GET", "settings/ai", undefined, bearer))).status).toBe(401);
    await setRole("MEMBER");
    expect((await put(CFG)).status).toBe(403);
    expect((await settings.GET(req("GET", "settings/ai"))).status).toBe(403);
    await setRole("OWNER");
  });

  it("stores the key encrypted and never returns it; a changed host needs a new key", async () => {
    expect(await json(await settings.GET(req("GET", "settings/ai")))).toEqual({ settings: null });
    expect((await put({ ...CFG, classifierEnabled: true, inputPricePerMTok: 1.5 })).status).toBe(
      200,
    );
    const got = await json(await settings.GET(req("GET", "settings/ai")));
    expect(got.settings).toMatchObject({
      baseUrl: CFG.baseUrl,
      model: "gpt-x",
      hasApiKey: true,
      classifierEnabled: true,
      inputPricePerMTok: 1.5,
    });
    expect(JSON.stringify(got)).not.toContain("sk-secret");
    const raw = (await db.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
      .aiConfigEnc!;
    expect(raw).not.toContain("sk-secret");
    // key omitted: kept
    expect((await put({ baseUrl: CFG.baseUrl, model: "gpt-y" })).status).toBe(200);
    const moved = await put({ baseUrl: "https://93.184.216.35/v1", model: "gpt-y" });
    expect(moved.status).toBe(400);
    expect(await json(moved)).toMatchObject({ error: "api_key_required" });
    expect((await put({ ...CFG, bogus: 1 })).status).toBe(400);
  });

  it("refuses a private or metadata base URL", async () => {
    expect(await json(await put({ ...CFG, baseUrl: "http://10.0.0.5/v1" }))).toMatchObject({
      error: "ai_host_not_public",
    });
    expect((await put({ ...CFG, baseUrl: "http://169.254.169.254/v1" })).status).toBe(400);
    expect((await put({ ...CFG, baseUrl: "http://localhost:11434/v1" })).status).toBe(400);
  });
});

describe("suggestions and feedback", () => {
  async function seed() {
    const P = db.prisma;
    const lead = await P.lead.create({ data: { workspaceId, email: `l${Date.now()}@lead.test` } });
    const sug = (kind: "PERSONALIZATION" | "DRAFT", text: string) =>
      P.aiSuggestion.create({ data: { workspaceId, kind, text, leadId: lead.id } });
    return { lead, sug };
  }

  it("lists, approves as MEMBER (personalization copied once, 409 after), a VIEWER cannot", async () => {
    const { lead, sug } = await seed();
    const a = await sug("PERSONALIZATION", "Nice post");
    const b = await sug("PERSONALIZATION", "Other");
    const got = await json(
      await list.GET(req("GET", `ai/suggestions?leadId=${lead.id}&status=PENDING`)),
    );
    expect(got.suggestions.map((s: { id: string }) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect((await list.GET(req("GET", "ai/suggestions?bogus=1"))).status).toBe(400);

    await setRole("VIEWER");
    expect((await one.PATCH(req("PATCH", "x", { status: "APPROVED" }), p(a.id))).status).toBe(403);
    expect((await list.GET(req("GET", "ai/suggestions"))).status).toBe(200);
    await setRole("MEMBER");
    const ok = await one.PATCH(req("PATCH", "x", { status: "APPROVED" }), p(a.id));
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ text: "Nice post", suggestion: { status: "APPROVED" } });
    expect(
      (await db.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).personalization,
    ).toBe("Nice post");
    const again = await one.PATCH(req("PATCH", "x", { status: "REJECTED" }), p(a.id));
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ error: "already_reviewed" });
    expect((await one.PATCH(req("PATCH", "x", { status: "REJECTED" }), p(b.id))).status).toBe(200);
    expect(
      (await db.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).personalization,
    ).toBe("Nice post");
    expect((await one.PATCH(req("PATCH", "x", { status: "NOPE" }), p(b.id))).status).toBe(400);
    expect((await one.PATCH(req("PATCH", "x", { status: "APPROVED" }), p("missing"))).status).toBe(
      404,
    );
    await setRole("OWNER");
  });

  it("an API key never reviews (401); ai:read lists", async () => {
    const { createApiKey } = await import("@rightnow/core");
    const key = async (scopes: string[]) => ({
      authorization: `Bearer ${(await createApiKey(db.prisma, workspaceId, scopes.join(","), scopes)).token}`,
    });
    const { sug } = await seed();
    const s = await sug("DRAFT", "Hi");
    for (const scopes of [["ai:read"], ["ai:write"], ["all:all"]])
      expect(
        (await one.PATCH(req("PATCH", "x", { status: "APPROVED" }, await key(scopes)), p(s.id)))
          .status,
      ).toBe(401);
    expect((await db.prisma.aiSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe(
      "PENDING",
    );
    expect(
      (await list.GET(req("GET", "ai/suggestions", undefined, await key(["ai:read"])))).status,
    ).toBe(200);
  });

  it("a key without inbox:read sees no thread-derived kinds; without leads:read no lead block (I1)", async () => {
    const { createApiKey } = await import("@rightnow/core");
    const key = async (scopes: string[]) => ({
      authorization: `Bearer ${(await createApiKey(db.prisma, workspaceId, scopes.join(","), scopes)).token}`,
    });
    const { lead, sug } = await seed();
    await sug("PERSONALIZATION", "P");
    await sug("DRAFT", "D");
    for (const kind of ["SUMMARY", "REPLY_DRAFT", "FOLLOWUP"] as const)
      await db.prisma.aiSuggestion.create({
        data: { workspaceId, kind, text: "thread text", leadId: lead.id },
      });
    const get = async (scopes: string[]) =>
      json(
        await list.GET(
          req("GET", `ai/suggestions?leadId=${lead.id}`, undefined, await key(scopes)),
        ),
      );
    const bare = await get(["ai:read"]);
    // round C: PERSONALIZATION text is lead data too
    expect(bare.suggestions.map((s: { kind: string }) => s.kind)).toEqual(["DRAFT"]);
    expect(bare.total).toBe(1);
    expect(bare.suggestions[0].lead).toBeUndefined();
    const inbox = await get(["ai:read", "inbox:read"]);
    expect(inbox.suggestions.map((s: { kind: string }) => s.kind).sort()).toEqual([
      "DRAFT",
      "FOLLOWUP",
      "REPLY_DRAFT",
      "SUMMARY",
    ]);
    const full = await get(["ai:read", "inbox:read", "leads:read"]);
    expect(full.suggestions).toHaveLength(5);
    expect(full.suggestions[0].lead).toMatchObject({ email: lead.email });
    // a session is unaffected
    const s = await json(await list.GET(req("GET", `ai/suggestions?leadId=${lead.id}`)));
    expect(s.suggestions).toHaveLength(5);
    expect(s.suggestions[0].lead).toMatchObject({ email: lead.email });
  });

  it("thumbs: 1 and -1 are stored and audited; anything else is 400; a VIEWER cannot", async () => {
    const P = db.prisma;
    const a = await P.emailAccount.create({
      data: {
        workspaceId,
        provider: "SMTP",
        email: "fb@send.test",
        fromName: "F",
        firstName: "F",
        lastName: "B",
        capTier: "SMTP",
        providerCap: 100,
      },
    });
    const t = await P.thread.create({
      data: {
        workspaceId,
        accountId: a.id,
        subject: "S",
        lastMessageAt: new Date(),
        categorySource: "AI",
      },
    });
    const m = await P.message.create({
      data: {
        workspaceId,
        accountId: a.id,
        threadId: t.id,
        rfcMessageId: "<fb@x>",
        direction: "IN",
        folder: "INBOX",
        fromEmail: "x@y.test",
        to: [a.email],
        subject: "S",
        sentAt: new Date(),
        kind: "REPLY",
        category: "INTERESTED",
      },
    });
    const vote = (v: unknown) => feedback.POST(req("POST", "x", { vote: v }), p(m.id));
    expect((await vote(-1)).status).toBe(200);
    expect((await P.message.findUniqueOrThrow({ where: { id: m.id } })).aiFeedback).toBe(-1);
    expect((await vote(1)).status).toBe(200);
    expect(
      await P.auditLog.count({ where: { workspaceId, action: "ai.feedback", target: m.id } }),
    ).toBe(2);
    expect((await vote(2)).status).toBe(400);
    await P.thread.update({ where: { id: t.id }, data: { categorySource: "RULE" } });
    expect((await vote(1)).status).toBe(404); // only AI-classified mail can be rated
    await P.thread.update({ where: { id: t.id }, data: { categorySource: "AI" } });
    expect((await feedback.POST(req("POST", "x", { vote: 1 }), p("missing"))).status).toBe(404);
    await setRole("VIEWER");
    expect((await vote(1)).status).toBe(403);
    await setRole("OWNER");
  });
});

describe("feature routes", () => {
  const routes = [
    ["draft", { stepId: "s" }],
    ["personalize", { leadIds: ["l"] }],
    ["followup", { leadId: "l" }],
    ["reply-draft", { threadId: "t" }],
    ["summary", { threadId: "t" }],
    ["score", { leadId: "l" }],
    ["recommend", { leadId: "l" }],
    ["campaign-analysis", { campaignId: "c" }],
  ] as const;
  const post = async (name: string, body: unknown) => {
    const m = (await import(
      `../app/api/v1/ai/${name}/route`
    )) as typeof import("../app/api/v1/ai/draft/route");
    return m.POST(req("POST", `ai/${name}`, body));
  };

  it("every one is 412 ai_not_configured while AI is off, 400 on a bad body", async () => {
    await db.prisma.workspace.update({ where: { id: workspaceId }, data: { aiConfigEnc: null } });
    for (const [name, body] of routes) {
      const r = await post(name, body);
      expect([name, r.status, (await json(r)).error]).toEqual([name, 412, "ai_not_configured"]);
    }
    expect((await post("draft", { stepId: "s", bogus: 1 })).status).toBe(400);
  });

  it("a key needs the scopes of the data each route reads (I1)", async () => {
    await db.prisma.workspace.update({ where: { id: workspaceId }, data: { aiConfigEnc: null } });
    const { createApiKey } = await import("@rightnow/core");
    const as = async (name: string, body: unknown, scopes: string[]) => {
      const m = (await import(
        `../app/api/v1/ai/${name}/route`
      )) as typeof import("../app/api/v1/ai/draft/route");
      const t = (await createApiKey(db.prisma, workspaceId, "k", scopes)).token;
      const r = await m.POST(req("POST", `ai/${name}`, body, { authorization: `Bearer ${t}` }));
      return [r.status, (await json(r)).error];
    };
    const needs: [string, unknown, string[]][] = [
      ["summary", { threadId: "t" }, ["inbox:read"]],
      ["reply-draft", { threadId: "t" }, ["inbox:read"]],
      ["followup", { leadId: "l" }, ["leads:read", "inbox:read"]],
      ["score", { leadId: "l" }, ["leads:read", "inbox:read", "leads:update"]],
      ["recommend", { leadId: "l" }, ["leads:read", "inbox:read", "crm:create"]],
      ["recommend", { opportunityId: "o" }, ["leads:read", "inbox:read", "crm:create", "crm:read"]],
      ["personalize", { leadIds: ["l"] }, ["leads:read"]],
      ["draft", { stepId: "s" }, ["campaigns:read"]],
      ["campaign-analysis", { campaignId: "c" }, ["campaigns:read", "analytics:read"]],
    ];
    for (const [name, body, extra] of needs) {
      for (const missing of extra)
        expect([
          name,
          ...(await as(name, body, ["ai:write", ...extra.filter((x) => x !== missing)])),
        ]).toEqual([name, 403, `scope_required:${missing}`]);
      // every scope held: the route goes on (AI is off here)
      expect([name, ...(await as(name, body, ["ai:write", ...extra]))]).toEqual([
        name,
        412,
        "ai_not_configured",
      ]);
    }
  });

  it("status reports whether AI is configured", async () => {
    const st = await import("../app/api/v1/ai/status/route");
    await db.prisma.workspace.update({ where: { id: workspaceId }, data: { aiConfigEnc: null } });
    expect(await json(await st.GET(req("GET", "ai/status")))).toEqual({ configured: false });
    expect((await put(CFG)).status).toBe(200);
    expect(await json(await st.GET(req("GET", "ai/status")))).toEqual({ configured: true });
  });

  it("personalize is 202 {jobId} with a queued ai_personalize job; a VIEWER and a read-only key are refused; an unknown step is 404", async () => {
    expect((await put(CFG)).status).toBe(200);
    const r = await post("personalize", { leadIds: ["l1", "l2"] });
    expect(r.status).toBe(202);
    const { jobId } = await json(r);
    expect(await db.prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject(
      {
        kind: "ai_personalize",
        status: "PENDING",
      },
    );
    expect((await post("draft", { stepId: "nope" })).status).toBe(404);
    const { createApiKey } = await import("@rightnow/core");
    const ro = (await createApiKey(db.prisma, workspaceId, "ro", ["ai:read"])).token;
    const m = await import("../app/api/v1/ai/score/route");
    expect(
      (await m.POST(req("POST", "ai/score", { leadId: "l" }, { authorization: `Bearer ${ro}` })))
        .status,
    ).toBe(403);
    await setRole("VIEWER");
    expect((await post("score", { leadId: "l" })).status).toBe(403);
    await setRole("OWNER");
  });
});
