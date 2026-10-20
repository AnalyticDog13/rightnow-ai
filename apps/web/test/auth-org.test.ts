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
