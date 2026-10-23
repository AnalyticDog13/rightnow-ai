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
let rules: typeof import("../app/api/v1/automations/rules/route");
let rule: typeof import("../app/api/v1/automations/rules/[id]/route");
let runs: typeof import("../app/api/v1/automations/rules/[id]/runs/route");
let builtin: typeof import("../app/api/v1/automations/builtin/route");
let builtinKey: typeof import("../app/api/v1/automations/builtin/[key]/route");

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
const pk = (key: string) => ({ params: Promise.resolve({ key }) });
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const task = { type: "create_task", title: "Follow up" };
const rule1 = { name: "Reply task", trigger: "reply_received", actions: [task] };
const mk = (b: unknown, h?: Record<string, string>) =>
  rules.POST(req("POST", "automations/rules", b, h));

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
  rules = await import("../app/api/v1/automations/rules/route");
  rule = await import("../app/api/v1/automations/rules/[id]/route");
  runs = await import("../app/api/v1/automations/rules/[id]/runs/route");
  builtin = await import("../app/api/v1/automations/builtin/route");
  builtinKey = await import("../app/api/v1/automations/builtin/[key]/route");
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
  readKey = (await createApiKey(db.prisma, workspaceId, "r", ["automations:read"])).token;
  writeKey = (await createApiKey(db.prisma, workspaceId, "w", ["automations:write"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("automation routes", () => {
  it("CRUD, validation, scopes and roles", async () => {
    expect((await mk(rule1, bearer(readKey))).status).toBe(403);
    const ok = await mk(rule1);
    expect(ok.status).toBe(200);
    const r = (await json(ok)) as { id: string; enabled: boolean };
    expect(r.enabled).toBe(true);
    expect((await mk({ ...rule1, name: "" })).status).toBe(400);
    expect(await json(await mk({ ...rule1, trigger: "nope" }))).toMatchObject({
      error: "unknown_trigger",
    });
    const foreign = { type: "add_to_list", listId: "other" };
    expect(await json(await mk({ ...rule1, actions: [foreign] }))).toMatchObject({
      error: "invalid_reference",
    });

    const list = await json(
      await rules.GET(req("GET", "automations/rules", undefined, bearer(readKey))),
    );
    expect((list.rules as { id: string }[]).map((x) => x.id)).toEqual([r.id]);
    const get = (id: string) =>
      rule.GET(req("GET", `automations/rules/${id}`, undefined, bearer(readKey)), p(id));
    expect((await get(r.id)).status).toBe(200);
    expect((await get("nope")).status).toBe(404);

    // R6: an automations:write key needs each action's own scope; lead actions need a lead
    const sup = { ...rule1, actions: [{ type: "suppress_contact" }] };
    const denied = await mk(sup, bearer(writeKey));
    expect(denied.status).toBe(403);
    expect(await json(denied)).toMatchObject({ error: "scope_required:blocklist:write" });
    expect(
      await json(
        await mk({ ...rule1, trigger: "quota_reached", actions: [{ type: "stop_sequence" }] }),
      ),
    ).toMatchObject({ error: "action_not_applicable" });
    const patchWith = (b: unknown, h?: Record<string, string>) =>
      rule.PATCH(req("PATCH", `automations/rules/${r.id}`, b, h), p(r.id));
    expect((await patchWith({ name: "x" }, bearer(writeKey))).status).toBe(403); // the rule's create_task needs crm:write

    expect(await json(await patchWith({ enabled: false, name: "Renamed" }))).toMatchObject({
      enabled: false,
      name: "Renamed",
    });
    expect((await patchWith({ bogus: 1 })).status).toBe(400);

    await setRole("viewer");
    expect((await mk(rule1)).status).toBe(403);
    expect((await rule.DELETE(req("DELETE", `automations/rules/${r.id}`), p(r.id))).status).toBe(
      403,
    );
    expect((await rules.GET(req("GET", "automations/rules"))).status).toBe(200);
    await setRole("owner");
    expect((await rule.DELETE(req("DELETE", `automations/rules/${r.id}`), p(r.id))).status).toBe(
      200,
    );
    expect((await rule.DELETE(req("DELETE", `automations/rules/${r.id}`), p(r.id))).status).toBe(
      404,
    );
  });

  it("runs page by cursor", async () => {
    const r = (await json(await mk(rule1))) as { id: string };
    await db.prisma.automationRun.createMany({
      data: [1, 2, 3].map((i) => ({
        workspaceId,
        ruleId: r.id,
        eventId: `e${i}`,
        status: "OK" as const,
        createdAt: new Date(2026, 0, i),
      })),
    });
    const page = (q: string, id = r.id) =>
      runs.GET(req("GET", `automations/rules/${id}/runs${q}`, undefined, bearer(readKey)), p(id));
    const first = await json(await page("?take=2"));
    expect((first.runs as { eventId: string }[]).map((x) => x.eventId)).toEqual(["e3", "e2"]);
    const next = await json(await page(`?take=2&cursor=${first.nextCursor}`));
    expect((next.runs as { eventId: string }[]).map((x) => x.eventId)).toEqual(["e1"]);
    expect(next.nextCursor).toBeNull();
    expect((await page("?take=x")).status).toBe(400);
    expect((await page("", "nope")).status).toBe(404);
  });

  it("built-ins: any reader lists, only a session ADMIN toggles", async () => {
    const list = await json(
      await builtin.GET(req("GET", "automations/builtin", undefined, bearer(readKey))),
    );
    const b = list.builtin as { key: string; locked: boolean; enabled: boolean }[];
    expect(b).toHaveLength(6);
    expect(b.find((x) => x.key === "positive_reply_opportunity")).toMatchObject({
      locked: false,
      enabled: true,
    });

    const patch = (key: string, enabled: unknown, h?: Record<string, string>) =>
      builtinKey.PATCH(req("PATCH", `automations/builtin/${key}`, { enabled }, h), pk(key));
    expect((await patch("positive_reply_opportunity", false, bearer(writeKey))).status).toBe(401);
    expect((await patch("positive_reply_opportunity", "no")).status).toBe(400);
    expect(await json(await patch("unsubscribe_suppress", false))).toMatchObject({
      error: "builtin_locked",
    });
    expect((await patch("nope", false)).status).toBe(404);
    await setRole("member");
    expect((await patch("positive_reply_opportunity", false)).status).toBe(403);
    await setRole("admin");
    expect((await patch("positive_reply_opportunity", false)).status).toBe(200);
    const ws = await db.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    expect(ws.crmAutoOpportunity).toBe(false);
    await setRole("owner");
    await patch("positive_reply_opportunity", true);
  });

  it("the workspace settings no longer take crmAutoOpportunity", async () => {
    const { updateWorkspaceSettings, systemClock } = await import("@rightnow/core");
    await expect(
      updateWorkspaceSettings(db.prisma, systemClock, workspaceId, null, {
        crmAutoOpportunity: false,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("every route is workspace-scoped", async () => {
    const { createRule, listRules } = await import("@rightnow/core");
    const other = await db.prisma.workspace.create({ data: { name: "X", slug: "x-auto" } });
    const fr = await createRule(db.prisma, other.id, null, rule1);
    const call = (m: string, h: (id: string) => Promise<Response>) =>
      h(fr.id).then((r) => [m, r.status]);
    expect(
      await Promise.all([
        call("get", (id) => rule.GET(req("GET", `automations/rules/${id}`), p(id))),
        call("patch", (id) =>
          rule.PATCH(req("PATCH", `automations/rules/${id}`, { name: "x" }), p(id)),
        ),
        call("delete", (id) => rule.DELETE(req("DELETE", `automations/rules/${id}`), p(id))),
        call("runs", (id) => runs.GET(req("GET", `automations/rules/${id}/runs`), p(id))),
      ]),
    ).toEqual([
      ["get", 404],
      ["patch", 404],
      ["delete", 404],
      ["runs", 404],
    ]);
    const mine = (await json(await rules.GET(req("GET", "automations/rules")))).rules as {
      id: string;
    }[];
    expect(mine.map((x) => x.id)).not.toContain(fr.id);
    await expectIsolated({
      prisma: db.prisma,
      seed: (ws) => createRule(db.prisma, ws, null, rule1),
      read: (ws) => listRules(db.prisma, ws),
    });
  });
});
