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
let leadId: string;
let foreignId: string;
let readKey: string;
let list: typeof import("../app/api/v1/leads/route");
let one: typeof import("../app/api/v1/leads/[id]/route");
let gdpr: typeof import("../app/api/v1/leads/[id]/gdpr-delete/route");
let bulk: typeof import("../app/api/v1/leads/bulk/route");
let merge: typeof import("../app/api/v1/leads/merge/route");
let labels: typeof import("../app/api/v1/lead-labels/route");

const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });
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
const patch = (id: string, body: unknown, headers?: Record<string, string>) =>
  one.PATCH(req("PATCH", `/api/v1/leads/${id}`, body, headers), p(id));
const post = (id: string) =>
  gdpr.POST(req("POST", `/api/v1/leads/${id}/gdpr-delete`, undefined), p(id));

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
  list = await import("../app/api/v1/leads/route");
  one = await import("../app/api/v1/leads/[id]/route");
  gdpr = await import("../app/api/v1/leads/[id]/gdpr-delete/route");
  bulk = await import("../app/api/v1/leads/bulk/route");
  merge = await import("../app/api/v1/leads/merge/route");
  labels = await import("../app/api/v1/lead-labels/route");
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
  leadId = (await db.prisma.lead.create({ data: { workspaceId, email: "mine@acme.io" } })).id;
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  foreignId = (await db.prisma.lead.create({ data: { workspaceId: other.id, email: "t@acme.io" } }))
    .id;
  readKey = (await createApiKey(db.prisma, workspaceId, "k", ["leads:read"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("leads routes", () => {
  it("lists and reads only this workspace's leads", async () => {
    const j = (await (await list.GET(req("GET", "/api/v1/leads"))).json()) as {
      leads: { id: string }[];
    };
    expect(j.leads.map((l) => l.id)).toEqual([leadId]);
    expect((await one.GET(req("GET", `/api/v1/leads/${leadId}`), p(leadId))).status).toBe(200);
    expect((await one.GET(req("GET", `/api/v1/leads/${foreignId}`), p(foreignId))).status).toBe(
      404,
    );
    expect((await patch(foreignId, { firstName: "x" })).status).toBe(404);
    expect((await post(foreignId)).status).toBe(404);
  });

  it("a leads:read key can GET but not POST", async () => {
    const h = { authorization: `Bearer ${readKey}` };
    expect((await list.GET(req("GET", "/api/v1/leads", undefined, h))).status).toBe(200);
    const r = await list.POST(req("POST", "/api/v1/leads", { email: "n@acme.io" }, h));
    expect(r.status).toBe(403);
  });

  it("a VIEWER cannot PATCH or POST", async () => {
    await setRole("viewer");
    expect((await patch(leadId, { firstName: "x" })).status).toBe(403);
    expect((await list.POST(req("POST", "/api/v1/leads", { email: "v@acme.io" }))).status).toBe(
      403,
    );
    await setRole("owner");
  });

  it("creates, rejects duplicates and unknown keys", async () => {
    const ok = await list.POST(req("POST", "/api/v1/leads", { email: "New@Acme.io" }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { email: string }).email).toBe("new@acme.io");
    const dup = await list.POST(req("POST", "/api/v1/leads", { email: "new@acme.io" }));
    expect(dup.status).toBe(409);
    expect((await patch(leadId, { workspaceId: "x" })).status).toBe(400);
    expect((await patch(leadId, { interestStatus: 7 })).status).toBe(400);
    expect((await patch(leadId, { interestStatus: 2 })).status).toBe(200);
  });

  it("MEMBER cannot GDPR-delete or bulk-delete; ADMIN can", async () => {
    await setRole("member");
    expect((await post(leadId)).status).toBe(403);
    const del = await bulk.POST(
      req("POST", "/api/v1/leads/bulk", { ids: [leadId], action: "delete" }),
    );
    expect(del.status).toBe(403);
    await setRole("admin");
    expect((await post(leadId)).status).toBe(200);
    await setRole("owner");
  });

  it("merge and labels work and stay in the workspace", async () => {
    const a = await db.prisma.lead.create({ data: { workspaceId, email: "ma@acme.io" } });
    const b = await db.prisma.lead.create({ data: { workspaceId, email: "mb@acme.io" } });
    const bad = await merge.POST(
      req("POST", "/api/v1/leads/merge", { keepId: a.id, mergeId: foreignId }),
    );
    expect(bad.status).toBe(404);
    const ok = await merge.POST(
      req("POST", "/api/v1/leads/merge", { keepId: a.id, mergeId: b.id }),
    );
    expect(ok.status).toBe(200);
    const lab = await labels.POST(
      req("POST", "/api/v1/lead-labels", { name: "Hot", color: "#ff0000" }),
    );
    expect(lab.status).toBe(200);
    const j = (await (await labels.GET(req("GET", "/api/v1/lead-labels"))).json()) as {
      labels: { name: string }[];
    };
    expect(j.labels.map((l) => l.name)).toEqual(["Hot"]);
  });
});
