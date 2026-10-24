import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
let db: Awaited<ReturnType<typeof createTestDb>>;
let auth: typeof import("../lib/auth").auth;
let workspaceId: string;

async function login(email: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
}

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local", // vitest sets MODE=test
    DATABASE_URL: db.url,
    APP_URL: "http://localhost:3100",
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
  });
  ({ auth } = await import("../lib/auth")); // after env: auth.ts reads it at import
  const owner = await createFirstOwner(
    db.prisma,
    { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
    TOKEN,
  );
  workspaceId = owner.workspaceId;
  const v = await db.prisma.user.create({
    data: { id: "viewer1", name: "V", email: "viewer@x.io" },
  });
  await db.prisma.account.create({
    data: {
      id: "acc-v",
      userId: v.id,
      accountId: v.id,
      providerId: "credential",
      password: await hashPassword(PASSWORD),
    },
  });
  await db.prisma.member.create({ data: { id: "m-v", workspaceId, userId: v.id, role: "viewer" } });
});
afterAll(async () => {
  await db.drop();
});

describe("organization endpoints are locked down", () => {
  it.each(["owner@x.io", "viewer@x.io"])("%s cannot create another workspace", async (email) => {
    const headers = await login(email);
    await expect(
      auth.api.createOrganization({ headers, body: { name: "Second", slug: "second" } }),
    ).rejects.toThrow();
    expect(await db.prisma.workspace.count()).toBe(1);
  });

  it("the OWNER cannot delete the workspace", async () => {
    await expect(
      auth.api.deleteOrganization({
        headers: await login("owner@x.io"),
        body: { organizationId: workspaceId },
      }),
    ).rejects.toThrow();
    expect(await db.prisma.workspace.count()).toBe(1);
  });

  it("a VIEWER cannot invite; the OWNER can", async () => {
    const body = { email: "new@x.io", role: "member" as const, organizationId: workspaceId };
    await expect(
      auth.api.createInvitation({ headers: await login("viewer@x.io"), body }),
    ).rejects.toThrow();
    expect(await db.prisma.invitation.count()).toBe(0);
    await auth.api.createInvitation({ headers: await login("owner@x.io"), body });
    expect(await db.prisma.invitation.count()).toBe(1);
  });
});

describe("raw /api/auth/organization/* is closed (R21): members change only through audited routes", () => {
  const raw = async (email: string, path: string, body: object) => {
    const { POST } = await import("../app/api/auth/[...all]/route");
    const origin = "http://localhost:3100";
    const cookie = (await login(email)).get("cookie")!;
    return POST(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  };

  it("the OWNER cannot leave and orphan the workspace", async () => {
    const r = await raw("owner@x.io", "/organization/leave", { organizationId: workspaceId });
    expect(r.status).toBe(404);
    expect(await db.prisma.member.count({ where: { workspaceId, role: "owner" } })).toBe(1);
  });

  it("an ADMIN cannot change roles, remove or invite members unaudited", async () => {
    const a = await db.prisma.user.create({ data: { id: "adm1", name: "A", email: "adm@x.io" } });
    await db.prisma.account.create({
      data: {
        id: "acc-a",
        userId: a.id,
        accountId: a.id,
        providerId: "credential",
        password: await hashPassword(PASSWORD),
      },
    });
    await db.prisma.member.create({
      data: { id: "m-a", workspaceId, userId: a.id, role: "admin" },
    });
    const calls: [string, object][] = [
      [
        "/organization/update-member-role",
        { memberId: "m-v", role: "admin", organizationId: workspaceId },
      ],
      ["/organization/remove-member", { memberIdOrEmail: "m-v", organizationId: workspaceId }],
      [
        "/organization/invite-member",
        { email: "z@x.io", role: "member", organizationId: workspaceId },
      ],
      ["/organization/accept-invitation", { invitationId: "x" }],
    ];
    for (const [path, body] of calls)
      expect((await raw("adm@x.io", path, body)).status, path).toBe(404);
    expect((await db.prisma.member.findUniqueOrThrow({ where: { id: "m-v" } })).role).toBe(
      "viewer",
    );
    expect(await db.prisma.invitation.count({ where: { email: "z@x.io" } })).toBe(0);
  });
});
