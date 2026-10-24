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
let foreign: { list: string; lead: string };
let lists: typeof import("../app/api/v1/lead-lists/route");
let oneList: typeof import("../app/api/v1/lead-lists/[id]/route");
let members: typeof import("../app/api/v1/lead-lists/[id]/leads/route");
let move: typeof import("../app/api/v1/lead-lists/[id]/move/route");
let stats: typeof import("../app/api/v1/lead-lists/[id]/stats/route");
let bl: typeof import("../app/api/v1/blocklist/route");
let blOne: typeof import("../app/api/v1/blocklist/[id]/route");
let blBulk: typeof import("../app/api/v1/blocklist/bulk-delete/route");
let blClear: typeof import("../app/api/v1/blocklist/clear/route");
let blExport: typeof import("../app/api/v1/blocklist/export/route");
let blImport: typeof import("../app/api/v1/blocklist/import/route");
let leadsExport: typeof import("../app/api/v1/leads/export/route");

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
/** Multipart request with a real Content-Length, like a browser sends. */
async function upload(file: File) {
  const fd = new FormData();
  fd.set("file", file);
  const probe = new Response(fd);
  const bytes = await probe.arrayBuffer();
  return new Request(`${ORIGIN}/api/v1/blocklist/import`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      cookie,
      "content-type": probe.headers.get("content-type")!,
      "content-length": String(bytes.byteLength),
    },
    body: bytes,
  });
}
/* eslint-disable @typescript-eslint/no-explicit-any -- test helper reads loose JSON */
const json = async (r: Response) => (await r.json()) as Record<string, any>;

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
  lists = await import("../app/api/v1/lead-lists/route");
  oneList = await import("../app/api/v1/lead-lists/[id]/route");
  members = await import("../app/api/v1/lead-lists/[id]/leads/route");
  move = await import("../app/api/v1/lead-lists/[id]/move/route");
  stats = await import("../app/api/v1/lead-lists/[id]/stats/route");
  bl = await import("../app/api/v1/blocklist/route");
  blOne = await import("../app/api/v1/blocklist/[id]/route");
  blBulk = await import("../app/api/v1/blocklist/bulk-delete/route");
  blClear = await import("../app/api/v1/blocklist/clear/route");
  blExport = await import("../app/api/v1/blocklist/export/route");
  blImport = await import("../app/api/v1/blocklist/import/route");
  leadsExport = await import("../app/api/v1/leads/export/route");
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
    list: (await db.prisma.leadList.create({ data: { workspaceId: other.id, name: "F" } })).id,
    lead: (await db.prisma.lead.create({ data: { workspaceId: other.id, email: "f@o.io" } })).id,
  };
});
afterAll(async () => {
  await db.drop();
});

describe("list routes", () => {
  it("create, add, move, stats and export-selected stay in the workspace", async () => {
    const a = await json(await lists.POST(req("POST", "/api/v1/lead-lists", { name: "A" })));
    const b = await json(await lists.POST(req("POST", "/api/v1/lead-lists", { name: "B" })));
    const l1 = await db.prisma.lead.create({ data: { workspaceId, email: "l1@a.io" } });
    const l2 = await db.prisma.lead.create({ data: { workspaceId, email: "l2@a.io" } });
    const add = await members.POST(
      req("POST", `/api/v1/lead-lists/${a.id}/leads`, { leadIds: [l1.id, l2.id, foreign.lead] }),
      p(a.id),
    );
    expect(await json(add)).toEqual({ added: 2 });
    const mv = await move.POST(
      req("POST", `/api/v1/lead-lists/${a.id}/move`, { leadIds: [l1.id], toListId: b.id }),
      p(a.id),
    );
    expect(await json(mv)).toEqual({ moved: 1, skipped: 0 });
    expect((await json(await stats.GET(req("GET", "/x"), p(a.id)))).NOT_VERIFIED).toBe(1);
    const all = await json(await lists.GET(req("GET", "/api/v1/lead-lists")));
    expect(all.lists.map((l: { name: string; count: number }) => [l.name, l.count])).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
    const rm = await members.DELETE(
      req("DELETE", `/api/v1/lead-lists/${a.id}/leads`, { leadIds: [l2.id] }),
      p(a.id),
    );
    expect(await json(rm)).toEqual({ removed: 1 });
    const csv = await (
      await leadsExport.GET(req("GET", `/api/v1/leads/export?ids=${l2.id}`))
    ).text();
    expect(csv).toContain("l2@a.io");
    expect(csv).not.toContain("l1@a.io");
  });

  it("another workspace's list is 404 everywhere", async () => {
    const f = foreign.list;
    expect((await oneList.PATCH(req("PATCH", "/x", { name: "z" }), p(f))).status).toBe(404);
    expect((await oneList.DELETE(req("DELETE", "/x"), p(f))).status).toBe(404);
    expect((await stats.GET(req("GET", "/x"), p(f))).status).toBe(404);
    const mv = await move.POST(req("POST", "/x", { leadIds: ["a"], toListId: "other" }), p(f));
    expect(mv.status).toBe(404);
  });
});

describe("blocklist routes", () => {
  it("add, list with total, export, import", async () => {
    const add = await bl.POST(
      req("POST", "/api/v1/blocklist", { values: ["Bad@X.test", "spam.test", "nope"] }),
    );
    expect(await json(add)).toEqual({ added: 2, duplicates: 0, invalid: 1 });
    const got = await json(await bl.GET(req("GET", "/api/v1/blocklist?kind=DOMAIN")));
    expect(got.total).toBe(1);
    expect(got.rows[0].value).toBe("spam.test");
    expect(got.rows[0].valueHash).toBeUndefined();
    expect((await blExport.GET(req("GET", "/x"))).headers.get("content-disposition")).toContain(
      "blocklist.csv",
    );
    const imp = await blImport.POST(await upload(new File(["value\r\nnew.test\r\n"], "b.csv")));
    expect(await json(imp)).toEqual({ added: 1, duplicates: 0, invalid: 0 });
  });

  it("rejects an oversized import before reading it", async () => {
    const r = await blImport.POST(
      await upload(new File([Buffer.alloc(6 * 1024 * 1024, "a")], "big.csv")),
    );
    expect(r.status).toBe(413);
  });

  it("removing is ADMIN-only and session-only; MEMBER gets 403 and API keys 401", async () => {
    const rows = (await json(await bl.GET(req("GET", "/api/v1/blocklist")))).rows;
    const id = rows[0].id as string;
    const { createApiKey } = await import("@rightnow/core");
    const key = (await createApiKey(db.prisma, workspaceId, "all", ["all:all"])).token;
    const k = { authorization: `Bearer ${key}` };
    await setRole("member");
    for (const r of [
      await blOne.DELETE(req("DELETE", "/x", {}), p(id)),
      await blBulk.POST(req("POST", "/x", { ids: [id] })),
      await blClear.POST(req("POST", "/x", { confirm: "DELETE ALL" })),
    ])
      expect(r.status).toBe(403);
    await setRole("admin");
    expect((await blOne.DELETE(req("DELETE", "/x", undefined, k), p(id))).status).toBe(401);
    expect((await blBulk.POST(req("POST", "/x", { ids: [id] }, k))).status).toBe(401);
    expect((await blClear.POST(req("POST", "/x", { confirm: "DELETE ALL" }, k))).status).toBe(401);
    expect((await blClear.POST(req("POST", "/x", { confirm: "no" }))).status).toBe(400);
    expect((await blOne.DELETE(req("DELETE", "/x", {}), p(id))).status).toBe(200);
    expect(await json(await blBulk.POST(req("POST", "/x", { ids: ["gone"] })))).toEqual({
      deleted: 0,
      kept: 0,
    });
    await setRole("owner");
  });

  it("D20 over the API: erasure 409, unsubscribe needs an attestation", async () => {
    const mk = (reason: "GDPR_ERASURE" | "UNSUBSCRIBE", h: string) =>
      db.prisma.suppression.create({
        data: { workspaceId, kind: "EMAIL", valueHash: h.repeat(64), reason },
      });
    const g = await mk("GDPR_ERASURE", "z");
    const u = await mk("UNSUBSCRIBE", "y");
    expect((await blOne.DELETE(req("DELETE", "/x", { confirm: true }), p(g.id))).status).toBe(409);
    expect((await blOne.DELETE(req("DELETE", "/x", {}), p(u.id))).status).toBe(400);
    const bad = { resubscribeAttestation: { reason: "x", recipientConsent: false } };
    expect((await blOne.DELETE(req("DELETE", "/x", bad), p(u.id))).status).toBe(400);
    const ok = {
      resubscribeAttestation: { reason: "asked to resubscribe", recipientConsent: true },
    };
    expect((await blOne.DELETE(req("DELETE", "/x", ok), p(u.id))).status).toBe(200);
  });

  it("export by ids refuses more than 1000 instead of cutting", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `i${i}`).join(",");
    expect((await leadsExport.GET(req("GET", `/api/v1/leads/export?ids=${ids}`))).status).toBe(400);
  });
});
