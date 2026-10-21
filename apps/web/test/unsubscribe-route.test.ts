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
let u: typeof import("../app/u/[token]/route");
let settings: typeof import("../app/api/v1/settings/workspace/route");
let core: typeof import("@rightnow/core");
let token: string;
let leadId: string;

const p = (t: string) => ({ params: Promise.resolve({ token: t }) });
const page = (method: string, t: string, body?: string) =>
  // no cookie, no origin: a mail client or a cross-site form
  (method === "GET" ? u.GET : u.POST)(
    new Request(`${ORIGIN}/u/${t}`, {
      method,
      headers: body ? { "content-type": "application/x-www-form-urlencoded" } : {},
      body,
    }),
    p(t),
  );
const sup = () => db.prisma.suppression.findMany({ where: { workspaceId } });
const patch = (body: unknown) =>
  settings.PATCH(
    new Request(`${ORIGIN}/api/v1/settings/workspace`, {
      method: "PATCH",
      headers: { origin: ORIGIN, "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );

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
  u = await import("../app/u/[token]/route");
  settings = await import("../app/api/v1/settings/workspace/route");
  core = await import("@rightnow/core");
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
  leadId = (await db.prisma.lead.create({ data: { workspaceId, email: "jane@acme.test" } })).id;
  const keys = core.unsubscribeKeys(core.getEnv());
  token = core.signUnsubscribe({ w: workspaceId, l: leadId, c: "c" }, keys[0]!);
});
afterAll(async () => {
  await db.drop();
});

describe("/u/[token]", () => {
  it("GET shows a confirm form and unsubscribes nobody", async () => {
    const r = await page("GET", token);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("<form");
    expect(html).toContain("j***@acme.test");
    expect(html).not.toContain("jane@acme.test");
    expect(await sup()).toHaveLength(0);
  });

  it("one-click POST suppresses, is idempotent, needs no cookie or origin", async () => {
    const body = "List-Unsubscribe=One-Click";
    const camp = await db.prisma.campaign.create({ data: { workspaceId, name: "c" } });
    const cl = await db.prisma.campaignLead.create({
      data: { workspaceId, campaignId: camp.id, leadId, state: "ACTIVE" },
    });
    const r = await page("POST", token, body);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("You have been unsubscribed.");
    expect((await sup()).map((s) => s.source)).toEqual(["one_click"]);
    expect((await page("POST", token, body)).status).toBe(200);
    expect(await sup()).toHaveLength(1);
    expect(await db.prisma.campaignLead.findUniqueOrThrow({ where: { id: cl.id } })).toMatchObject({
      state: "STOPPED",
      stopReason: "UNSUBSCRIBED",
    });
    expect(await (await page("GET", token)).text()).toContain("You are unsubscribed.");
  });

  it("a tampered or foreign token is a bare 400", async () => {
    const bad = (token[0] === "A" ? "B" : "A") + token.slice(1);
    for (const m of ["GET", "POST"]) {
      const r = await page(m, bad);
      expect(r.status).toBe(400);
      const html = await r.text();
      expect(html).toContain("This unsubscribe link is invalid.");
      expect(html).not.toContain("acme");
    }
    expect((await page("POST", "nonsense")).status).toBe(400);
  });

  it("a token for a GDPR-erased lead still answers 200", async () => {
    const l = await db.prisma.lead.create({ data: { workspaceId, email: "gone@acme.test" } });
    await core.gdprDeleteLead(db.prisma, core.systemClock, workspaceId, l.id);
    const t = core.signUnsubscribe(
      { w: workspaceId, l: l.id, c: "c" },
      core.unsubscribeKeys(core.getEnv())[0]!,
    );
    const r = await page("POST", t, "List-Unsubscribe=One-Click");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("You have been unsubscribed.");
  });
});

describe("PATCH /api/v1/settings/workspace", () => {
  const setRole = (role: string) =>
    db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });
  it("MEMBER gets 403", async () => {
    await setRole("MEMBER");
    expect((await patch({ physicalAddress: "x" })).status).toBe(403);
    await setRole("ADMIN");
  });
  it("ADMIN sets the address and it is audited; GET returns it", async () => {
    const r = await patch({ physicalAddress: "1 Main St, Springfield" });
    expect(r.status).toBe(200);
    const w = await db.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    expect(w.physicalAddress).toBe("1 Main St, Springfield");
    expect(
      await db.prisma.auditLog.count({ where: { workspaceId, action: "settings.update" } }),
    ).toBe(1);
    const g = await settings.GET(
      new Request(`${ORIGIN}/api/v1/settings/workspace`, { headers: { cookie } }),
    );
    expect(await g.json()).toMatchObject({ physicalAddress: "1 Main St, Springfield" });
  });
  it("a bad timezone is 400", async () => {
    expect((await patch({ timezone: "Bad/Zone" })).status).toBe(400);
  });
});
