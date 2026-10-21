import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { seedCampaign } from "../../../packages/core/test/campaign-fixture";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let list: typeof import("../app/api/v1/scheduled-messages/route");
let release: typeof import("../app/api/v1/scheduled-messages/[id]/release/route");
let cancel: typeof import("../app/api/v1/scheduled-messages/[id]/cancel/route");
let retry: typeof import("../app/api/v1/scheduled-messages/[id]/retry/route");

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
const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });

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
  list = await import("../app/api/v1/scheduled-messages/route");
  release = await import("../app/api/v1/scheduled-messages/[id]/release/route");
  cancel = await import("../app/api/v1/scheduled-messages/[id]/cancel/route");
  retry = await import("../app/api/v1/scheduled-messages/[id]/retry/route");
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
afterAll(async () => {
  await db.drop();
});

it("list, release, cancel, retry: roles, confirm, 409, 404 and one audit row per action", async () => {
  const P = db.prisma;
  const at = new Date();
  const s = await seedCampaign(P, { at, workspaceId, rows: 4, steps: 2, accounts: [{}] });
  const [held, failed, scheduled, sent] = s.rows.map((r) => r.id) as [
    string,
    string,
    string,
    string,
  ];
  await P.scheduledMessage.update({
    where: { id: held },
    data: { status: "HELD", uncertainAt: at, error: "lease_expired" },
  });
  await P.scheduledMessage.update({ where: { id: failed }, data: { status: "FAILED" } });
  await P.campaignLead.update({
    where: { id: s.leads[1]!.cl.id },
    data: { state: "PAUSED", stopReason: "SEND_FAILED" },
  });
  await P.scheduledMessage.update({ where: { id: sent }, data: { status: "SENT", sentAt: at } });
  const foreign = await seedCampaign(P, { at, rows: 1, accounts: [{}] });

  const l = await list.GET(req("GET", "/api/v1/scheduled-messages?status=HELD"));
  expect(l.status).toBe(200);
  const body = (await l.json()) as { rows: Record<string, unknown>[] };
  expect(body.rows.map((r) => r.id)).toEqual([held]);
  expect(body.rows[0]).toMatchObject({
    leadEmail: s.leads[0]!.lead.email,
    uncertainAt: at.toISOString(), // the search history the releaser decides on
    searchCount: 0,
    lastSearchAt: null,
  });

  await setRole("VIEWER");
  expect((await release.POST(req("POST", "/x", { confirm: true }), p(held))).status).toBe(403);
  await setRole("MEMBER");
  // a release may send a second copy: ADMIN in a session only, never an API key (like test-send)
  expect((await release.POST(req("POST", "/x", { confirm: true }), p(held))).status).toBe(403);
  const { createApiKey } = await import("@rightnow/core");
  const key = (await createApiKey(P, workspaceId, "w", ["campaigns:write"])).token;
  const k = { authorization: `Bearer ${key}` };
  expect((await release.POST(req("POST", "/x", { confirm: true }, k), p(held))).status).toBe(403);
  expect((await cancel.POST(req("POST", "/x", undefined, k), p(foreign.rows[0]!.id))).status).toBe(
    404,
  ); // cancel stays MEMBER, keys allowed
  await setRole("ADMIN");
  expect((await release.POST(req("POST", "/x", {}), p(held))).status).toBe(400);
  expect((await release.POST(req("POST", "/x", { confirm: true }), p(sent))).status).toBe(409);
  expect(
    (await release.POST(req("POST", "/x", { confirm: true }), p(foreign.rows[0]!.id))).status,
  ).toBe(404);
  expect((await cancel.POST(req("POST", "/x"), p(foreign.rows[0]!.id))).status).toBe(404);
  expect((await retry.POST(req("POST", "/x"), p(foreign.rows[0]!.id))).status).toBe(404);

  expect((await release.POST(req("POST", "/x", { confirm: true }), p(held))).status).toBe(200);
  expect((await retry.POST(req("POST", "/x"), p(failed))).status).toBe(200);
  expect((await cancel.POST(req("POST", "/x"), p(scheduled))).status).toBe(200);
  expect((await cancel.POST(req("POST", "/x"), p(sent))).status).toBe(409);
  const rows = await P.scheduledMessage.findMany({
    where: { id: { in: [held, failed, scheduled] } },
  });
  expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
    [held]: "SCHEDULED",
    [failed]: "SCHEDULED",
    [scheduled]: "CANCELLED",
  });
  const audits = await P.auditLog.findMany({
    where: { workspaceId, action: { startsWith: "message." } },
  });
  expect(audits.map((a) => `${a.action} ${a.target}`).sort()).toEqual(
    [`message.cancel ${scheduled}`, `message.release ${held}`, `message.retry ${failed}`].sort(),
  );
  expect(await P.auditLog.count({ where: { workspaceId: foreign.ws } })).toBe(0);
  await setRole("OWNER");
});
