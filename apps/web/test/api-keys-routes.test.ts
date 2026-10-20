import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let keys: typeof import("../app/api/v1/api-keys/route");
let one: typeof import("../app/api/v1/api-keys/[id]/route");

const call = (h: (r: Request) => Promise<Response>, method: string, url: string, body?: unknown) =>
  h(
    new Request(`${ORIGIN}${url}`, {
      method,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local", // vitest sets MODE=test
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
  });
  const { auth } = await import("../lib/auth"); // after env: reads it at import
  keys = await import("../app/api/v1/api-keys/route");
  one = await import("../app/api/v1/api-keys/[id]/route");
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

describe("api-keys routes + audit", () => {
  it("sign-in is audited", async () => {
    const rows = await db.prisma.auditLog.findMany({
      where: { workspaceId, action: "auth.sign_in" },
    });
    expect(rows).toHaveLength(1);
  });

  it("create shows the token once, list omits it, revoke audited, validation enforced", async () => {
    const bad = await call(keys.POST, "POST", "/api/v1/api-keys", {
      name: "x",
      scopes: ["root:all"],
    });
    expect(bad.status).toBe(400);
    const res = await call(keys.POST, "POST", "/api/v1/api-keys", {
      name: "ci",
      scopes: ["leads:read"],
    });
    const { id, token } = await res.json();
    expect(token).toMatch(/^rn_/);
    const list = await (await call(keys.GET, "GET", "/api/v1/api-keys")).text();
    expect(list).toContain(id);
    expect(list).not.toContain(token);
    expect((await call(one.DELETE, "DELETE", `/api/v1/api-keys/${id}`)).status).toBe(200);
    expect((await call(one.DELETE, "DELETE", `/api/v1/api-keys/${id}`)).status).toBe(404);
    const rows = await db.prisma.auditLog.findMany({ where: { target: id } });
    expect(rows.map((a) => a.action).sort()).toEqual(["apikey.create", "apikey.revoke"]);
    expect(JSON.stringify(await db.prisma.auditLog.findMany())).not.toContain(token);
  });
});
