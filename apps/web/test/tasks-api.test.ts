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
let tasks: typeof import("../app/api/v1/crm/tasks/route");
let task: typeof import("../app/api/v1/crm/tasks/[id]/route");
let activity: typeof import("../app/api/v1/crm/activity/route");
let notes: typeof import("../app/api/v1/inbox/notes/route");

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
  tasks = await import("../app/api/v1/crm/tasks/route");
  task = await import("../app/api/v1/crm/tasks/[id]/route");
  activity = await import("../app/api/v1/crm/activity/route");
  notes = await import("../app/api/v1/inbox/notes/route");
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
  writeKey = (await createApiKey(db.prisma, workspaceId, "w", ["crm:write"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("task routes", () => {
  it("CRUD, scopes, validation and foreign ids", async () => {
    const l = await lead();
    const mk = (b: unknown, h?: Record<string, string>) =>
      tasks.POST(req("POST", "crm/tasks", b, h));
    expect((await mk({ title: "x" }, bearer(readKey))).status).toBe(403);
    const ok = await mk(
      { title: "Call", leadId: l.id, dueAt: "2020-01-01T00:00:00Z" },
      bearer(writeKey),
    );
    expect(ok.status).toBe(200);
    const t = (await json(ok)) as { id: string; status: string };
    expect(t.status).toBe("OPEN");
    expect((await mk({ title: "" })).status).toBe(400);
    expect((await mk({ title: "x", assigneeId: "nobody" })).status).toBe(400);
    expect(await json(await mk({ title: "x", assigneeId: "nobody" }))).toMatchObject({
      error: "unknown_owner",
    });
    expect((await mk({ title: "x", leadId: "nope" })).status).toBe(404);

    const list = await json(
      await tasks.GET(req("GET", "crm/tasks?due=overdue", undefined, bearer(readKey))),
    );
    expect((list.tasks as { id: string }[]).map((x) => x.id)).toEqual([t.id]);
    expect((await tasks.GET(req("GET", "crm/tasks?due=whenever"))).status).toBe(400);

    expect(
      (
        await task.PATCH(
          req("PATCH", `crm/tasks/${t.id}`, { status: "DONE" }, bearer(readKey)),
          p(t.id),
        )
      ).status,
    ).toBe(403);
    const done = await json(
      await task.PATCH(req("PATCH", `crm/tasks/${t.id}`, { status: "DONE" }), p(t.id)),
    );
    expect(done.completedAt).not.toBeNull();
    expect(
      (await task.PATCH(req("PATCH", `crm/tasks/${t.id}`, { status: "NOPE" }), p(t.id))).status,
    ).toBe(400);

    const feed = await json(
      await activity.GET(req("GET", `crm/activity?leadId=${l.id}`, undefined, bearer(readKey))),
    );
    expect((feed.items as { kind: string }[]).map((i) => i.kind)).toEqual(["task", "task"]);
    expect((await activity.GET(req("GET", "crm/activity?cursor=junk"))).status).toBe(400);

    // a viewer cannot write
    await setRole("viewer");
    expect((await mk({ title: "v" })).status).toBe(403);
    expect((await task.DELETE(req("DELETE", `crm/tasks/${t.id}`), p(t.id))).status).toBe(403);
    await setRole("owner");
    expect((await task.DELETE(req("DELETE", `crm/tasks/${t.id}`), p(t.id))).status).toBe(200);
    expect((await task.DELETE(req("DELETE", `crm/tasks/${t.id}`), p(t.id))).status).toBe(404);
  });

  it("every route is workspace-scoped", async () => {
    const { createTask, crmActivity, systemClock } = await import("@rightnow/core");
    const other = await db.prisma.workspace.create({ data: { name: "X", slug: "x-task" } });
    const foreignLead = await lead(other.id);
    const stages = await db.prisma.pipelineStage.create({
      data: { workspaceId: other.id, name: "S", position: 0, kind: "OPEN" },
    });
    const foreignOpp = await db.prisma.opportunity.create({
      data: { workspaceId: other.id, leadId: foreignLead.id, stageId: stages.id, title: "t" },
    });
    const ft = await createTask(db.prisma, systemClock, other.id, null, {
      title: "f",
      leadId: foreignLead.id,
    });
    expect(
      (await task.PATCH(req("PATCH", `crm/tasks/${ft.id}`, { title: "x" }), p(ft.id))).status,
    ).toBe(404);
    expect((await task.DELETE(req("DELETE", `crm/tasks/${ft.id}`), p(ft.id))).status).toBe(404);
    const body = (r: Response) => json(r);
    const mine = (await body(await tasks.GET(req("GET", "crm/tasks")))).tasks as { id: string }[];
    expect(mine.map((x) => x.id)).not.toContain(ft.id);
    expect(
      (await tasks.POST(req("POST", "crm/tasks", { title: "x", opportunityId: foreignOpp.id })))
        .status,
    ).toBe(404);
    expect(
      (await tasks.POST(req("POST", "crm/tasks", { title: "x", leadId: foreignLead.id }))).status,
    ).toBe(404);
    expect(
      (await body(await activity.GET(req("GET", `crm/activity?leadId=${foreignLead.id}`)))).items,
    ).toEqual([]);

    await expectIsolated({
      prisma: db.prisma,
      seed: async (ws) => {
        const l = await lead(ws);
        const t = await createTask(db.prisma, systemClock, ws, "u", { title: "s", leadId: l.id });
        await db.prisma.task.update({ where: { id: t.id }, data: { status: "DONE" } });
        await db.prisma.auditLog.create({
          data: { workspaceId: ws, action: "task.update", target: t.id, meta: { leadId: l.id } },
        });
      },
      read: async (ws) => (await crmActivity(db.prisma, ws, {})).items,
    });
  });

  it("activity for a deleted, unknown or foreign deal is not a 500", async () => {
    const { createOpportunity, systemClock, ensureStages } = await import("@rightnow/core");
    const l = await lead();
    const o = await createOpportunity(db.prisma, systemClock, workspaceId, "u", { leadId: l.id });
    const other = await db.prisma.workspace.create({ data: { name: "Y", slug: "y-act" } });
    const st = (await ensureStages(db.prisma, other.id))[0]!;
    const fo = await db.prisma.opportunity.create({
      data: {
        workspaceId: other.id,
        leadId: (await lead(other.id)).id,
        stageId: st.id,
        title: "f",
      },
    });
    await db.prisma.opportunity.delete({ where: { id: o.id } });
    const feed = async (id: string) => {
      const r = await activity.GET(req("GET", `crm/activity?opportunityId=${id}`));
      expect(r.status).toBe(200);
      return ((await json(r)).items as unknown[]).length;
    };
    expect(await feed(o.id)).toBeGreaterThan(0); // history survives the deal
    expect(await feed("nope")).toBe(0);
    expect(await feed(fo.id)).toBe(0);
  });

  it("notes: a kind is accepted, a bad one is 400", async () => {
    const l = await lead();
    const post = (b: unknown) => notes.POST(req("POST", "inbox/notes", b));
    expect(await json(await post({ leadId: l.id, body: "rang", kind: "call" }))).toMatchObject({
      kind: "call",
    });
    expect((await post({ leadId: l.id, body: "fax", kind: "fax" })).status).toBe(400);
  });
});
