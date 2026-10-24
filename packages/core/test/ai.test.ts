import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb } from "@rightnow/db/test-db";
import { HttpOutError, type SafeResponse } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { aiComplete } from "../src/ai/client";
import { classifyPrompt, leadFields, oooPrompt } from "../src/ai/prompts";
import { getAiSettings, loadAiConfig, setAiSettings } from "../src/ai/settings";
import { createSuggestion, listSuggestions, reviewSuggestion } from "../src/ai/suggestions";
import { fixedClock } from "../src/clock";
import { decrypt, ENCRYPTED_COLUMNS, encrypt } from "../src/crypto";
import { createLabel, gdprDeleteLead, updateLabel } from "../src/leads/service";
import { planDue, renderForLead } from "../src/planner";
import { unsubscribeKeys, type RenderEnv } from "../src/unsubscribe";
import { testEnv } from "./accounts-fixture";
import { seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  testEnv();
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const clock = fixedClock(T);
const PUBLIC = { allowPrivate: false, resolve: async () => ["93.184.216.34"] };
const CFG = { baseUrl: "https://llm.example.com/v1", apiKey: "sk-secret-123", model: "m" };
let n = 0;
const workspace = async (config = true) => {
  const w = await P().workspace.create({
    data: {
      name: "W",
      slug: `ai-${++n}-${randomBytes(3).toString("hex")}`,
      physicalAddress: "1 Main St",
    },
  });
  if (config) await setAiSettings(P(), w.id, null, CFG, PUBLIC);
  return w.id;
};
const reply = (
  content: string,
  usage: object = { prompt_tokens: 12, completion_tokens: 3 },
): SafeResponse => ({
  status: 200,
  headers: {},
  latencyMs: 1,
  body: Buffer.from(JSON.stringify({ choices: [{ message: { content } }], usage, model: "m" })),
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => ({ status: (e as { status?: number }).status, message: (e as Error).message }),
  );

describe("settings", () => {
  test("aiConfigEnc is encrypted, in ENCRYPTED_COLUMNS, and GET never returns the key", async () => {
    const ws = await workspace(false);
    await setAiSettings(P(), ws, "u1", { ...CFG, inputPricePerMTok: 1 }, PUBLIC);
    const raw = (await P().workspace.findUniqueOrThrow({ where: { id: ws } })).aiConfigEnc!;
    expect(raw).not.toContain("sk-secret-123");
    expect(raw).not.toContain("llm.example.com");
    expect(JSON.parse(decrypt(raw))).toMatchObject({ apiKey: "sk-secret-123", model: "m" });
    expect(ENCRYPTED_COLUMNS).toContainEqual({ model: "Workspace", field: "aiConfigEnc" });
    const got = await getAiSettings(P(), ws);
    expect(got).toMatchObject({
      baseUrl: CFG.baseUrl,
      model: "m",
      hasApiKey: true,
      inputPricePerMTok: 1,
    });
    expect(JSON.stringify(got)).not.toContain("sk-secret");
    expect(await getAiSettings(P(), await workspace(false))).toBeNull();
    expect(
      await P().auditLog.count({
        where: { workspaceId: ws, action: "ai.settings", actorId: "u1" },
      }),
    ).toBe(1);
  });

  test("an omitted key is kept on the same host; a changed host needs a new key", async () => {
    const ws = await workspace();
    await setAiSettings(P(), ws, null, { baseUrl: CFG.baseUrl, model: "m2" }, PUBLIC);
    expect((await loadAiConfig(P(), ws))!).toMatchObject({ apiKey: "sk-secret-123", model: "m2" });
    expect(
      await code(
        setAiSettings(
          P(),
          ws,
          null,
          { baseUrl: "https://other.example.com/v1", model: "m" },
          PUBLIC,
        ),
      ),
    ).toEqual({ status: 400, message: "api_key_required" });
    await setAiSettings(
      P(),
      ws,
      null,
      { baseUrl: "https://other.example.com/v1", apiKey: "new", model: "m" },
      PUBLIC,
    );
    expect((await loadAiConfig(P(), ws))!.apiKey).toBe("new");
  });

  test("private hosts are refused unless allowed; cloud metadata always; bad urls and unknown keys are 400", async () => {
    const ws = await workspace(false);
    const set = (baseUrl: string, env: Parameters<typeof setAiSettings>[4]) =>
      code(setAiSettings(P(), ws, null, { ...CFG, baseUrl }, env));
    const to = (ip: string) => ({ allowPrivate: false, resolve: async () => [ip] });
    expect(await set("https://llm.internal.test/v1", to("10.0.0.5"))).toMatchObject({
      status: 400,
    });
    expect(await set("http://localhost:11434/v1", { allowPrivate: false })).toMatchObject({
      status: 400,
    });
    expect(
      await set("http://llm.internal.test/v1", {
        allowPrivate: true,
        resolve: async () => ["10.0.0.5"],
      }),
    ).toBeNull();
    expect(
      await set("http://llm.internal.test/v1", {
        allowPrivate: true,
        resolve: async () => ["169.254.169.254"],
      }),
    ).toMatchObject({ status: 400 });
    expect(await set("https://u:p@llm.example.com/v1", PUBLIC)).toMatchObject({
      message: "invalid_url",
    });
    expect(await set("ftp://llm.example.com/v1", PUBLIC)).toMatchObject({ message: "invalid_url" });
    expect(await code(setAiSettings(P(), ws, null, { ...CFG, extra: 1 }, PUBLIC))).toMatchObject({
      status: 400,
    });
  });
});

describe("client", () => {
  test("a 200 returns the text and logs hash, tokens and cost", async () => {
    const ws = await workspace(false);
    await setAiSettings(
      P(),
      ws,
      null,
      { ...CFG, inputPricePerMTok: 2, outputPricePerMTok: 10 },
      PUBLIC,
    );
    const seen: { url: string; auth?: string; body: string }[] = [];
    const out = await aiComplete(
      P(),
      clock,
      ws,
      "draft",
      { system: "S", user: "U", maxTokens: 50 },
      {
        ...PUBLIC,
        fetchFn: async (url, o) => {
          seen.push({ url, auth: o.headers?.authorization, body: String(o.body) });
          return reply("hi");
        },
      },
    );
    expect(out.text).toBe("hi");
    expect(seen[0]).toMatchObject({
      url: "https://llm.example.com/v1/chat/completions",
      auth: "Bearer sk-secret-123",
    });
    const call = await P().aiCall.findUniqueOrThrow({ where: { id: out.callId } });
    expect(call).toMatchObject({
      feature: "draft",
      model: "m",
      inputTokens: 12,
      outputTokens: 3,
      status: "ok",
      errorCode: null,
    });
    expect(call.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.costMicros).toBe(54n); // 12 * 2 + 3 * 10
    expect(Object.values(call)).not.toContain("U");
  });

  test("a 500 is ai_http_500 with an error AiCall and no body in the error", async () => {
    const ws = await workspace();
    const e = await code(
      aiComplete(
        P(),
        clock,
        ws,
        "draft",
        { system: "S", user: "U", maxTokens: 5 },
        {
          ...PUBLIC,
          fetchFn: async () => ({
            status: 500,
            headers: {},
            latencyMs: 1,
            body: Buffer.from("SECRET BODY sk-secret-123"),
          }),
        },
      ),
    );
    expect(e).toEqual({ status: 502, message: "ai_http_500" });
    expect(await P().aiCall.findFirstOrThrow({ where: { workspaceId: ws } })).toMatchObject({
      status: "error",
      errorCode: "ai_http_500",
    });
  });

  test("a 2 MB answer, a malformed answer and a transport failure map to codes", async () => {
    const ws = await workspace();
    const run = (fetchFn: NonNullable<Parameters<typeof aiComplete>[5]["fetchFn"]>) =>
      code(
        aiComplete(
          P(),
          clock,
          ws,
          "f",
          { system: "S", user: "U", maxTokens: 5 },
          { ...PUBLIC, fetchFn },
        ),
      );
    expect(
      await run(async () => ({
        status: 200,
        headers: {},
        latencyMs: 1,
        body: Buffer.alloc(2 * 1024 * 1024, "a"),
      })),
    ).toMatchObject({ message: "ai_bad_response" });
    expect(
      await run(async () => ({ status: 200, headers: {}, latencyMs: 1, body: Buffer.from("{}") })),
    ).toMatchObject({ message: "ai_bad_response" });
    expect(
      await run(async () => {
        throw new HttpOutError("response_too_large");
      }),
    ).toMatchObject({ message: "ai_bad_response" });
    expect(
      await run(async () => {
        throw new HttpOutError("timeout");
      }),
    ).toMatchObject({ message: "ai_timeout" });
    expect(
      await run(async () => {
        throw new HttpOutError("host_not_public");
      }),
    ).toMatchObject({ message: "ai_host_not_public" });
    expect(
      await run(async () => ({
        status: 302,
        headers: { location: "http://127.0.0.1/" },
        latencyMs: 1,
        body: Buffer.alloc(0),
      })),
    ).toMatchObject({ message: "ai_http_302" });
    expect(await P().aiCall.count({ where: { workspaceId: ws, status: "error" } })).toBe(6);
  });

  test("with no config every call is 412 ai_not_configured and nothing is fetched", async () => {
    const ws = await workspace(false);
    let called = false;
    const e = await code(
      aiComplete(
        P(),
        clock,
        ws,
        "f",
        { system: "S", user: "U", maxTokens: 5 },
        { ...PUBLIC, fetchFn: async () => ((called = true), reply("x")) },
      ),
    );
    expect(e).toEqual({ status: 412, message: "ai_not_configured" });
    expect(called).toBe(false);
  });
});

describe("prompts never carry secrets", () => {
  test("allowlisted builders drop credentials, headers and tokens", async () => {
    const TOKEN = "ya29.A0-OAUTH-TOKEN";
    const enc = encrypt(JSON.stringify({ accessToken: TOKEN }));
    const s = await seedCampaign(P(), { at: T, leads: 1, accounts: [{ credentialsEnc: enc }] });
    const lead = await P().lead.update({
      where: { id: s.leads[0]!.lead.id },
      data: {
        firstName: "Ann",
        companyName: "Acme",
        customFields: { city: "Oslo", nested: { x: TOKEN } },
      },
    });
    const text =
      "Sounds ok.\nUnsubscribe: https://track.example.com/u/UNSUBTOKEN123\nhttps://track.example.com/t/TRACKTOKEN456?x=1";
    const all = [
      leadFields({ ...lead, credentialsEnc: enc, token: TOKEN } as never),
      JSON.stringify(
        classifyPrompt({ subject: "Re: Hi", text }, [
          { name: "Pricing", aiDescription: "asks price" },
        ]),
      ),
      JSON.stringify(oooPrompt({ subject: "OOO", text })),
    ].join("\n");
    expect(all).toContain("Ann");
    expect(all).toContain("city: Oslo");
    for (const bad of [
      TOKEN,
      enc,
      "/u/",
      "/t/",
      "UNSUBTOKEN123",
      "TRACKTOKEN456",
      s.accounts[0]!.email,
      "credentialsEnc",
    ])
      expect(all, bad).not.toContain(bad);
  });
});

describe("approval invariant", () => {
  const ENV: RenderEnv = {
    appUrl: "https://app.example.com",
    unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
  };
  const evil = "Loved your post {{unsubscribe_url}} {{unsubscribeLink}}";

  test("a PENDING personalization reaches nothing; approving stores it unchanged; it renders literally", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 1 });
    await P().stepVariant.update({
      where: { id: s.steps[0]!.variant.id },
      data: { body: "Hi {{personalization}} bye" },
    });
    await P().campaignLead.updateMany({
      where: { campaignId: s.campaign.id },
      data: { state: "QUEUED", currentStepId: null, nextDueAt: null },
    });
    const L = s.leads[0]!.lead.id;
    const call = await P().aiCall.create({
      data: {
        workspaceId: s.ws,
        feature: "personalize",
        model: "m",
        promptHash: "h",
        inputTokens: 1,
        outputTokens: 1,
        status: "ok",
      },
    });
    const sug = await createSuggestion(
      P(),
      s.ws,
      { kind: "PERSONALIZATION", text: evil, leadId: L },
      call.id,
    );
    expect(sug.status).toBe("PENDING");
    expect((await P().aiCall.findUniqueOrThrow({ where: { id: call.id } })).suggestionId).toBe(
      sug.id,
    );

    await planDue(P(), clock, {
      stalenessSec: 300,
      sendableProviders: ["GMAIL", "MICROSOFT", "SMTP"],
      env: ENV,
    });
    const rows = await P().scheduledMessage.findMany({ where: { campaignId: s.campaign.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.renderedBody + rows[0]!.renderedText).not.toContain("Loved your post");
    expect((await P().lead.findUniqueOrThrow({ where: { id: L } })).personalization).toBeNull();

    const rejected = await reviewSuggestion(
      P(),
      clock,
      s.ws,
      "u1",
      (
        await createSuggestion(
          P(),
          s.ws,
          { kind: "PERSONALIZATION", text: "no", leadId: L },
          call.id,
        )
      ).id,
      "REJECTED",
    );
    expect(rejected).toMatchObject({
      text: null,
      suggestion: { status: "REJECTED", reviewerId: "u1" },
    });
    expect((await P().lead.findUniqueOrThrow({ where: { id: L } })).personalization).toBeNull();

    const ok = await reviewSuggestion(P(), clock, s.ws, "u2", sug.id, "APPROVED");
    expect(ok.text).toBe(evil);
    const lead = await P().lead.findUniqueOrThrow({ where: { id: L } });
    expect(lead.personalization).toBe("Loved your post {{unsubscribe_url}} {{unsubscribeLink}}");
    expect(
      await P().auditLog.count({
        where: { workspaceId: s.ws, action: "ai.approve", actorId: "u2", target: sug.id },
      }),
    ).toBe(1);
    expect(
      await P().auditLog.count({
        where: { workspaceId: s.ws, action: "ai.reject", actorId: "u1" },
      }),
    ).toBe(1);

    const campaign = await P().campaign.findUniqueOrThrow({ where: { id: s.campaign.id } });
    const out = renderForLead({
      campaign,
      step: s.steps[0]!,
      variant: await P().stepVariant.findUniqueOrThrow({ where: { id: s.steps[0]!.variant.id } }),
      lead,
      account: s.accounts[0]!,
      workspace: await P().workspace.findUniqueOrThrow({ where: { id: s.ws } }),
      env: ENV,
    });
    expect(out.text).toContain("Hi Loved your post {{unsubscribe_url}} {{unsubscribeLink}} bye");
    expect(out.text).not.toContain("{ {");

    expect(await code(reviewSuggestion(P(), clock, s.ws, "u2", sug.id, "APPROVED"))).toEqual({
      status: 409,
      message: "already_reviewed",
    });
    expect(await code(reviewSuggestion(P(), clock, s.ws, "u2", sug.id, "REJECTED"))).toEqual({
      status: 409,
      message: "already_reviewed",
    });
    expect(
      await code(reviewSuggestion(P(), clock, await workspace(false), "u2", sug.id, "APPROVED")),
    ).toMatchObject({ status: 404 });
  });

  test("approving a personalization whose lead is gone is 404 lead_not_found and stays PENDING", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 1 });
    const L = s.leads[0]!.lead.id;
    const sug = await P().aiSuggestion.create({
      data: { workspaceId: s.ws, kind: "PERSONALIZATION", text: "x", leadId: L },
    });
    await P().lead.update({ where: { id: L }, data: { deletedAt: T } });
    expect(await code(reviewSuggestion(P(), clock, s.ws, "u", sug.id, "APPROVED"))).toEqual({
      status: 404,
      message: "lead_not_found",
    });
    expect((await P().aiSuggestion.findUniqueOrThrow({ where: { id: sug.id } })).status).toBe(
      "PENDING",
    );
  });

  test("two concurrent approvals: one wins, one is 409", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 1 });
    const sug = await P().aiSuggestion.create({
      data: { workspaceId: s.ws, kind: "PERSONALIZATION", text: "x", leadId: s.leads[0]!.lead.id },
    });
    const r = await Promise.all(
      [1, 2].map(() => code(reviewSuggestion(P(), clock, s.ws, "u", sug.id, "APPROVED"))),
    );
    expect(r.filter((x) => x === null)).toHaveLength(1);
    expect(r.filter((x) => x?.status === 409)).toHaveLength(1);
  });

  test("a draft kind is returned as written (the editor keeps its merge tags)", async () => {
    const ws = await workspace();
    const s = await P().aiSuggestion.create({
      data: { workspaceId: ws, kind: "DRAFT", text: "Hi {{firstName}}" },
    });
    expect((await reviewSuggestion(P(), clock, ws, "u", s.id, "APPROVED")).text).toBe(
      "Hi {{firstName}}",
    );
  });

  test("only suggestions.ts writes AiSuggestion status or copies suggestion text into a lead", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const dirs = [
      "packages/core/src",
      "apps/web/app",
      "apps/web/lib",
      "apps/web/components",
      "apps/worker/src",
    ];
    // leads/service.ts only deletes suggestions on erasure and names the lead field in its own schema
    const SKIP = new Set([
      "packages/core/src/ai/suggestions.ts",
      "packages/core/src/leads/service.ts",
    ]);
    const hits: string[] = [];
    for (const d of dirs)
      for (const f of readdirSync(join(root, d), { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(f)) continue;
        const rel = relative(root, join(root, d, f))
          .split(sep)
          .join("/");
        const src = readFileSync(join(root, d, f), "utf8");
        const mentions = /aiSuggestion/i.test(src);
        if (rel !== "packages/core/src/ai/suggestions.ts") {
          if (/aiSuggestion\s*\.\s*(update|updateMany|upsert)\b|"AiSuggestion"\s+SET/.test(src))
            hits.push(`${rel}: update`);
          for (const m of src.matchAll(/aiSuggestion\s*\.\s*create(Many)?\b/g))
            if (/\bstatus\b/.test(src.slice(m.index, m.index + 400)))
              hits.push(`${rel}: create with status`);
        }
        if (!SKIP.has(rel) && mentions && /personalization/.test(src))
          hits.push(`${rel}: suggestion + personalization`);
      }
    expect(hits).toEqual([]);
  });
});

describe("gdpr purges suggestions", () => {
  test("erasing a lead deletes its suggestions and those on its threads, even with a null leadId", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 2 });
    const [a, b] = s.leads.map((l) => l.lead);
    const mk = async (email: string, leadId: string | null) => {
      const t = await P().thread.create({
        data: {
          workspaceId: s.ws,
          accountId: s.accounts[0]!.id,
          subject: "Re: Hi",
          lastMessageAt: T,
          leadId,
        },
      });
      await P().message.create({
        data: {
          workspaceId: s.ws,
          accountId: s.accounts[0]!.id,
          threadId: t.id,
          rfcMessageId: `<${randomBytes(4).toString("hex")}@x>`,
          direction: "IN",
          folder: "INBOX",
          fromEmail: email,
          to: [s.accounts[0]!.email],
          subject: "Re: Hi",
          sentAt: T,
          kind: "REPLY",
        },
      });
      return t.id;
    };
    const unlinked = await mk(a!.email, null);
    const others = await mk(b!.email, b!.id);
    const sug = (o: object) =>
      P().aiSuggestion.create({
        data: { workspaceId: s.ws, text: "t", kind: "REPLY_DRAFT", ...o },
      });
    await sug({ leadId: a!.id, kind: "PERSONALIZATION" });
    await sug({ threadId: unlinked });
    const keep = await sug({ threadId: others, leadId: b!.id });
    await gdprDeleteLead(P(), clock, s.ws, a!.id);
    expect(
      (await P().aiSuggestion.findMany({ where: { workspaceId: s.ws } })).map((x) => x.id),
    ).toEqual([keep.id]);
  });
});

test("listSuggestions filters by status and kind, scoped to the workspace", async () => {
  const [w1, w2] = [await workspace(false), await workspace(false)];
  const mk = (
    workspaceId: string,
    kind: "DRAFT" | "SUMMARY",
    status: "PENDING" | "APPROVED" = "PENDING",
  ) => P().aiSuggestion.create({ data: { workspaceId, kind, status, text: "t" } });
  await mk(w1, "DRAFT");
  await mk(w1, "SUMMARY");
  await mk(w1, "DRAFT", "APPROVED");
  await mk(w2, "DRAFT");
  expect((await listSuggestions(P(), w1, {})).suggestions).toHaveLength(3);
  expect(
    (await listSuggestions(P(), w1, { status: "PENDING", kind: "DRAFT" })).suggestions,
  ).toHaveLength(1);
  const page = await listSuggestions(P(), w1, { take: 2 });
  expect(page.suggestions).toHaveLength(2);
  expect(page.nextCursor).toBeTruthy();
  expect(await code(listSuggestions(P(), w1, { bogus: 1 }))).toBeTruthy();
});

test("listSuggestions names the lead (email, name, company only) and counts the total", async () => {
  const ws = await workspace(false);
  const l = await P().lead.create({
    data: {
      workspaceId: ws,
      email: "ann@acme.test",
      firstName: "Ann",
      companyName: "Acme",
      phone: "555",
    },
  });
  for (let i = 0; i < 3; i++)
    await P().aiSuggestion.create({
      data: { workspaceId: ws, kind: "PERSONALIZATION", text: `t${i}`, leadId: l.id },
    });
  const r = await listSuggestions(P(), ws, { status: "PENDING", take: 2 });
  expect(r.total).toBe(3);
  expect(r.suggestions).toHaveLength(2);
  expect(r.suggestions[0]!.lead).toEqual({
    email: "ann@acme.test",
    firstName: "Ann",
    lastName: null,
    companyName: "Acme",
  });
});

test("a label is created and updated with aiSelectable", async () => {
  const ws = await workspace(false);
  const l = await createLabel(P(), ws, null, {
    name: "Pricing",
    color: "#aabbcc",
    aiSelectable: true,
  });
  expect(l.aiSelectable).toBe(true);
  expect((await updateLabel(P(), ws, l.id, { aiSelectable: false })).aiSelectable).toBe(false);
  expect((await createLabel(P(), ws, null, { name: "Plain", color: "#aabbcc" })).aiSelectable).toBe(
    false,
  );
});
