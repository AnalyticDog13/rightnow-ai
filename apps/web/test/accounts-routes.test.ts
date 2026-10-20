import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let accountId: string;
let foreignId: string;
let readKey: string;
let list: typeof import("../app/api/v1/accounts/route");
let one: typeof import("../app/api/v1/accounts/[id]/route");
let pause: typeof import("../app/api/v1/accounts/[id]/pause/route");
let bulk: typeof import("../app/api/v1/accounts/bulk/route");

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
  one.PATCH(req("PATCH", `/api/v1/accounts/${id}`, body, headers), p(id));

const mk = (workspaceId: string, email: string) =>
  db.prisma.emailAccount.create({
    data: {
      workspaceId,
      provider: "GMAIL",
      email,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: "GMAIL_WORKSPACE",
      providerCap: 1500,
    },
  });

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local",
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
  });
  const { auth } = await import("../lib/auth");
  const { createApiKey } = await import("@rightnow/core");
  list = await import("../app/api/v1/accounts/route");
  one = await import("../app/api/v1/accounts/[id]/route");
  pause = await import("../app/api/v1/accounts/[id]/pause/route");
  bulk = await import("../app/api/v1/accounts/bulk/route");
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
  accountId = (await mk(workspaceId, "mine@acme.io")).id;
  const other = await db.prisma.workspace.create({ data: { name: "Other", slug: "other" } });
  foreignId = (await mk(other.id, "theirs@acme.io")).id;
  readKey = (await createApiKey(db.prisma, workspaceId, "k", ["accounts:read"])).token;
});
afterAll(async () => {
  await db.drop();
});

describe("accounts routes", () => {
  it("lists and reads only this workspace's accounts, never credentials", async () => {
    const res = await list.GET(req("GET", "/api/v1/accounts"));
    const j = (await res.json()) as { accounts: { id: string }[] };
    expect(j.accounts.map((a) => a.id)).toEqual([accountId]);
    expect(JSON.stringify(j)).not.toContain("credentialsEnc");
    expect((await one.GET(req("GET", `/api/v1/accounts/${accountId}`), p(accountId))).status).toBe(
      200,
    );
    expect((await one.GET(req("GET", `/api/v1/accounts/${foreignId}`), p(foreignId))).status).toBe(
      404,
    );
    expect((await patch(foreignId, { fromName: "x" })).status).toBe(404);
  });

  it("an accounts:read key can GET but not PATCH", async () => {
    const h = { authorization: `Bearer ${readKey}` };
    expect((await list.GET(req("GET", "/api/v1/accounts", undefined, h))).status).toBe(200);
    expect((await patch(accountId, { fromName: "x" }, h)).status).toBe(403);
  });

  it("a VIEWER cannot PATCH; a MEMBER cannot delete or bulk delete", async () => {
    await setRole("viewer");
    expect((await patch(accountId, { fromName: "x" })).status).toBe(403);
    await setRole("member");
    expect(
      (await one.DELETE(req("DELETE", `/api/v1/accounts/${accountId}`), p(accountId))).status,
    ).toBe(403);
    const del = await bulk.POST(
      req("POST", "/api/v1/accounts/bulk", { ids: [accountId], action: "delete" }),
    );
    expect(del.status).toBe(403);
    expect((await patch(accountId, { fromName: "Member Edit" })).status).toBe(200);
    await setRole("owner");
  });

  it("unknown body property is 400; limits clamp with a warning", async () => {
    expect((await patch(accountId, { credentialsEnc: "x" })).status).toBe(400);
    const res = await patch(accountId, { dailyLimit: 99999 });
    const j = (await res.json()) as { account: { dailyLimit: number }; warnings: unknown[] };
    expect(j.account.dailyLimit).toBe(750);
    expect(j.warnings).toEqual([{ field: "dailyLimit", clampedTo: 750, reason: "provider_cap" }]);
  });

  it("pause then bulk resume", async () => {
    const r = await pause.POST(
      req("POST", `/api/v1/accounts/${accountId}/pause`, {}),
      p(accountId),
    );
    expect(((await r.json()) as { displayStatus: string }).displayStatus).toBe("PAUSED");
    const b = await bulk.POST(
      req("POST", "/api/v1/accounts/bulk", { ids: [accountId, foreignId], action: "resume" }),
    );
    expect(await b.json()).toEqual({
      results: [
        { id: accountId, ok: true },
        { id: foreignId, ok: false, error: "not_found" },
      ],
    });
  });
});
