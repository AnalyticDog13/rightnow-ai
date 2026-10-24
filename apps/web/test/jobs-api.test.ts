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
let otherWs: string;
let cookie: string;
let core: typeof import("@rightnow/core");
let bulk: typeof import("../app/api/v1/leads/bulk/route");
let jobsList: typeof import("../app/api/v1/jobs/route");
let job: typeof import("../app/api/v1/jobs/[id]/route");
let audits: typeof import("../app/api/v1/audit-logs/route");
let tags: typeof import("../app/api/v1/tags/route");
let members: typeof import("../app/api/v1/members/route");
let exportRoute: typeof import("../app/api/v1/leads/[id]/export/route");

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
const json = (r: Response) => r.json() as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const keyWith = async (scopes: string[]) =>
  (await core.createApiKey(db.prisma, workspaceId, scopes.join(","), scopes)).token;
const mkLead = (ws: string, email: string, data: object = {}) =>
  db.prisma.lead.create({ data: { workspaceId: ws, email, ...data } });

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
  bulk = await import("../app/api/v1/leads/bulk/route");
  jobsList = await import("../app/api/v1/jobs/route");
  job = await import("../app/api/v1/jobs/[id]/route");
  audits = await import("../app/api/v1/audit-logs/route");
  tags = await import("../app/api/v1/tags/route");
  members = await import("../app/api/v1/members/route");
  exportRoute = await import("../app/api/v1/leads/[id]/export/route");
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
  otherWs = (await db.prisma.workspace.create({ data: { name: "B", slug: "other-b" } })).id;
});
afterAll(() => db.drop());

describe("background jobs, audit log, tags, members and lead export routes", () => {
  it("bulk with a filter answers 202 {jobId}; ids stay synchronous; a delete filter needs ADMIN", async () => {
    await mkLead(workspaceId, "f1@acme.test", { tags: ["x"] });
    const r = await bulk.POST(
      req("POST", "leads/bulk", { filter: { tag: "x" }, action: "add_tags", value: ["y"] }),
    );
    expect(r.status).toBe(202);
    const { jobId } = await json(r);
    expect(jobId).toEqual(expect.any(String));
    expect(await db.prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject(
      {
        workspaceId,
        kind: "leads_bulk",
        status: "PENDING",
        createdById: expect.any(String),
      },
    );

    expect(
      (await bulk.POST(req("POST", "leads/bulk", { action: "add_tags", value: ["y"] }))).status,
    ).toBe(400);
    expect(
      (
        await bulk.POST(
          req("POST", "leads/bulk", { ids: ["a"], filter: {}, action: "add_tags", value: ["y"] }),
        )
      ).status,
    ).toBe(400);
    const sync = await json(
      await bulk.POST(
        req("POST", "leads/bulk", {
          ids: [(await db.prisma.lead.findFirstOrThrow({ where: { workspaceId } })).id],
          action: "add_tags",
          value: ["z"],
        }),
      ),
    );
    expect(sync).toEqual({ affected: 1 });
    const key = await keyWith(["leads:write"]);
    const del = await bulk.POST(
      req("POST", "leads/bulk", { filter: { tag: "x" }, action: "delete" }, bearer(key)),
    );
    expect(del.status).toBe(403);
  });

  it("jobs: list and read need jobs:read; another workspace's job is a 404", async () => {
    const mine = (await db.prisma.backgroundJob.findFirstOrThrow({ where: { workspaceId } })).id;
    const theirs = (await core.createJob(db.prisma, otherWs, null, "leads_bulk", {})).jobId;
    const readKey = await keyWith(["jobs:read"]);
    const other = await keyWith(["leads:read"]);
    expect(
      (await job.GET(req("GET", `jobs/${mine}`, undefined, bearer(other)), p(mine))).status,
    ).toBe(403);
    const got = await json(
      await job.GET(req("GET", `jobs/${mine}`, undefined, bearer(readKey)), p(mine)),
    );
    expect(got).toMatchObject({ id: mine, kind: "leads_bulk", status: "PENDING", progress: 0 });
    expect((await job.GET(req("GET", `jobs/${theirs}`), p(theirs))).status).toBe(404);
    const list = await json(
      await jobsList.GET(req("GET", "jobs?status=PENDING", undefined, bearer(readKey))),
    );
    expect(list.jobs.map((j: { id: string }) => j.id)).toEqual([mine]);
    expect(list.nextCursor).toBeNull();
    await expectIsolated({
      prisma: db.prisma,
      seed: (ws) => core.createJob(db.prisma, ws, null, "leads_bulk", {}),
      read: async (ws) => (await core.listJobs(db.prisma, ws, {})).jobs,
    });
  });

  it("audit-logs: action prefix, newest first, paged; scope audit:read", async () => {
    const at = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m));
    for (const [m, action] of [
      [1, "webhook.create"],
      [2, "lead.bulk"],
      [3, "webhook.update"],
      [4, "webhook.delete"],
    ] as const)
      await db.prisma.auditLog.create({ data: { workspaceId, action, createdAt: at(m) } });
    await db.prisma.auditLog.create({
      data: { workspaceId: otherWs, action: "webhook.create", createdAt: at(5) },
    });
    const key = await keyWith(["audit:read"]);
    const page1 = await json(
      await audits.GET(req("GET", "audit-logs?action=webhook.&take=2", undefined, bearer(key))),
    );
    expect(page1.logs.map((l: { action: string }) => l.action)).toEqual([
      "webhook.delete",
      "webhook.update",
    ]);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = await json(
      await audits.GET(req("GET", `audit-logs?action=webhook.&take=2&cursor=${page1.nextCursor}`)),
    );
    expect(page2.logs.map((l: { action: string }) => l.action)).toEqual(["webhook.create"]);
    expect(page2.nextCursor).toBeNull();
    const ranged = await json(
      await audits.GET(
        req(
          "GET",
          `audit-logs?from=${at(2).toISOString()}&to=${at(3).toISOString()}&action=webhook.`,
        ),
      ),
    );
    expect(ranged.logs.map((l: { action: string }) => l.action)).toEqual(["webhook.update"]);
    expect(JSON.stringify(page1)).not.toContain(otherWs);
    expect(
      (await audits.GET(req("GET", "audit-logs", undefined, bearer(await keyWith(["jobs:read"])))))
        .status,
    ).toBe(403);
    await expectIsolated({
      prisma: db.prisma,
      seed: (ws) => db.prisma.auditLog.create({ data: { workspaceId: ws, action: "x.y" } }),
      read: async (ws) => (await core.listAuditLogs(db.prisma, ws, {})).logs,
    });
  });

  it("tags: distinct sorted values per kind, deleted rows and other workspaces excluded", async () => {
    const camp = (ws: string, name: string, tg: string[], deletedAt?: Date) =>
      db.prisma.campaign.create({ data: { workspaceId: ws, name, tags: tg, deletedAt } as never });
    await camp(workspaceId, "c1", ["zeta", "alpha"]);
    await camp(workspaceId, "c2", ["alpha", "mid"]);
    await camp(workspaceId, "gone", ["deleted-only"], new Date());
    await camp(otherWs, "c3", ["foreign"]);
    const key = await keyWith(["workspace:read"]);
    const get = async (kind: string) =>
      json(await tags.GET(req("GET", `tags?kind=${kind}`, undefined, bearer(key))));
    expect(await get("campaign")).toEqual({ tags: ["alpha", "mid", "zeta"] });
    expect(await get("lead")).toEqual({ tags: ["x", "z"] });
    expect(await get("account")).toEqual({ tags: [] });
    expect((await tags.GET(req("GET", "tags?kind=nope"))).status).toBe(400);
  });

  it("members: {id,userId,email,name,role} only, this workspace only", async () => {
    const key = await keyWith(["workspace:read"]);
    const out = await json(await members.GET(req("GET", "members", undefined, bearer(key))));
    expect(out.members).toHaveLength(1);
    expect(Object.keys(out.members[0]).sort()).toEqual(["email", "id", "name", "role", "userId"]);
    expect(out.members[0]).toMatchObject({ email: "owner@x.io", name: "O", role: "owner" });
    expect(JSON.stringify(out)).not.toMatch(/password|session|token|hash/i);
    expect(
      (await members.GET(req("GET", "members", undefined, bearer(await keyWith(["jobs:read"])))))
        .status,
    ).toBe(403);
  });

  it("lead export: a leads:read key downloads the JSON and it is audited; another workspace's lead is 404", async () => {
    const lead = await mkLead(workspaceId, "ex@acme.test");
    const foreign = await mkLead(otherWs, "ex2@acme.test");
    const key = await keyWith(["leads:read"]);
    const r = await exportRoute.GET(
      req("GET", `leads/${lead.id}/export`, undefined, bearer(key)),
      p(lead.id),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toBe(
      `attachment; filename="lead-${lead.id}.json"`,
    );
    expect(await json(r)).toMatchObject({
      lead: { id: lead.id, email: "ex@acme.test" },
      threads: [],
      notes: [],
    });
    expect(
      await db.prisma.auditLog.count({
        where: { workspaceId, action: "lead.export", target: lead.id },
      }),
    ).toBe(1);
    expect(
      (await exportRoute.GET(req("GET", `leads/${foreign.id}/export`), p(foreign.id))).status,
    ).toBe(404);
    expect(
      (
        await exportRoute.GET(
          req("GET", `leads/${lead.id}/export`, undefined, bearer(await keyWith(["jobs:read"]))),
          p(lead.id),
        )
      ).status,
    ).toBe(403);
  });

  it("a filter bulk with a bad value is a 400 like the ids path, and queues nothing", async () => {
    const before = await db.prisma.backgroundJob.count();
    for (const body of [
      { filter: { tag: "x" }, action: "add_tags", value: null },
      { ids: ["a"], action: "add_tags", value: null },
    ])
      expect((await bulk.POST(req("POST", "leads/bulk", body))).status).toBe(400);
    expect(await db.prisma.backgroundJob.count()).toBe(before);
  });

  it("expectIsolated through the routes: tags, members, jobs/[id] and the lead export", async () => {
    const keys = new Map<string, string>();
    const as = async (ws: string) => {
      if (!keys.has(ws))
        keys.set(
          ws,
          (
            await core.createApiKey(db.prisma, ws, "iso", [
              "workspace:read",
              "jobs:read",
              "leads:read",
            ])
          ).token,
        );
      return bearer(keys.get(ws)!);
    };
    const ids = { job: "", lead: "" };
    const iso = (
      seed: (ws: string) => Promise<unknown>,
      read: (ws: string) => Promise<unknown[]>,
    ) => expectIsolated({ prisma: db.prisma, seed, read });

    await iso(
      async (ws) => {
        await mkLead(ws, "t@iso.test", { tags: ["iso-tag"] });
      },
      async (ws) =>
        (await json(await tags.GET(req("GET", "tags?kind=lead", undefined, await as(ws))))).tags,
    );
    await iso(
      async (ws) => {
        const user = await db.prisma.user.create({
          data: { id: `u-${ws}`, name: "U", email: `${ws}@iso.test` },
        });
        await db.prisma.member.create({
          data: { id: `m-${ws}`, workspaceId: ws, userId: user.id, role: "member" },
        });
      },
      async (ws) =>
        (await json(await members.GET(req("GET", "members", undefined, await as(ws))))).members,
    );
    // B asks for A's id: a 404 reads as nothing
    await iso(
      async (ws) => {
        ids.job = (await core.createJob(db.prisma, ws, null, "nope", {})).jobId;
      },
      async (ws) => {
        const r = await job.GET(req("GET", `jobs/${ids.job}`, undefined, await as(ws)), p(ids.job));
        return r.status === 200 ? [await json(r)] : [];
      },
    );
    await iso(
      async (ws) => {
        ids.lead = (await mkLead(ws, "e@iso.test")).id;
      },
      async (ws) => {
        const r = await exportRoute.GET(
          req("GET", `leads/${ids.lead}/export`, undefined, await as(ws)),
          p(ids.lead),
        );
        return r.status === 200 ? [await json(r)] : [];
      },
    );
  });
});
