import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let auth: typeof import("../lib/auth").auth;
let workspaceId: string;
let ownerMember: string;
const cookies: Record<string, string> = {};
let invites: typeof import("../app/api/v1/invites/route");
let invite: typeof import("../app/api/v1/invites/[id]/route");
let members: typeof import("../app/api/v1/members/route");
let member: typeof import("../app/api/v1/members/[id]/route");
let accept: typeof import("../app/api/invite/accept/route");
let apiKeys: typeof import("../app/api/v1/api-keys/route");

const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${url}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const as = (who: string) => ({ cookie: cookies[who]! });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (r: Response) => r.json() as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const inviteAs = (who: string, email: string, role = "member") =>
  invites.POST(req("POST", "/api/v1/invites", { email, role }, as(who)));
const acceptBody = (invitationId: string, over: object = {}) => ({
  invitationId,
  name: "New Person",
  password: PASSWORD,
  ...over,
});
const doAccept = (b: unknown) => accept.POST(req("POST", "/api/invite/accept", b));
const patchRole = (who: string, id: string, role: string) =>
  member.PATCH(req("PATCH", `/api/v1/members/${id}`, { role }, as(who)), p(id));
const removeAs = (who: string, id: string) =>
  member.DELETE(req("DELETE", `/api/v1/members/${id}`, undefined, as(who)), p(id));
const auditActions = async () =>
  (await db.prisma.auditLog.findMany({ where: { workspaceId } })).map((a) => a.action);

async function login(email: string) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
/** A user with a credential and a membership, made directly (the accept route has its own tests). */
async function mkUser(key: string, role: string) {
  const email = `${key}@x.io`;
  const u = await db.prisma.user.create({ data: { id: `u-${key}`, name: key, email } });
  await db.prisma.account.create({
    data: {
      id: `a-${key}`,
      userId: u.id,
      accountId: u.id,
      providerId: "credential",
      password: await hashPassword(PASSWORD),
    },
  });
  await db.prisma.member.create({ data: { id: `m-${key}`, workspaceId, userId: u.id, role } });
  cookies[key] = await login(email);
}

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
  ({ auth } = await import("../lib/auth"));
  invites = await import("../app/api/v1/invites/route");
  invite = await import("../app/api/v1/invites/[id]/route");
  members = await import("../app/api/v1/members/route");
  member = await import("../app/api/v1/members/[id]/route");
  accept = await import("../app/api/invite/accept/route");
  apiKeys = await import("../app/api/v1/api-keys/route");
  ({ workspaceId } = await createFirstOwner(
    db.prisma,
    { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
    TOKEN,
  ));
  cookies.owner = await login("owner@x.io");
  ownerMember = (await db.prisma.member.findFirstOrThrow({ where: { role: "owner" } })).id;
  await mkUser("admin", "admin");
  await mkUser("member", "member");
  await mkUser("viewer", "viewer");
});
afterAll(() => db.drop());
beforeEach(() => db.prisma.rateLimitBucket.deleteMany()); // the accept route is limited per IP

describe("invites", () => {
  it("an ADMIN invites new@x.com; accept creates the user, credential and MEMBER row; the link is single-use", async () => {
    const r = await inviteAs("admin", "New@X.com");
    expect(r.status).toBe(200);
    const { id } = await json(r);
    expect(id).toEqual(expect.any(String));
    const row = await db.prisma.invitation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ email: "new@x.com", role: "member", status: "pending" });
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const listed = await json(
      await invites.GET(req("GET", "/api/v1/invites", undefined, as("admin"))),
    );
    expect(listed.invites.map((i: { id: string }) => i.id)).toContain(id);

    const ok = await doAccept(acceptBody(id));
    expect(ok.status).toBe(200);
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: "new@x.com" } });
    expect(user.name).toBe("New Person");
    expect(
      await db.prisma.account.count({ where: { userId: user.id, providerId: "credential" } }),
    ).toBe(1);
    expect(await db.prisma.member.findFirst({ where: { userId: user.id } })).toMatchObject({
      workspaceId,
      role: "member",
    });
    expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id } })).status).toBe(
      "accepted",
    );
    expect(await auditActions()).toEqual(expect.arrayContaining(["member.invite", "member.join"]));
    // the new member signs in with the chosen password
    expect(await login("new@x.com")).toContain("session_token");

    const again = await doAccept(acceptBody(id));
    expect(again.status).toBe(409);
    expect(await json(again)).toEqual({ error: "invite_used" });
  });

  it("an expired invite is 410 invite_expired; an unknown id 404; a short password 400", async () => {
    const { id } = await json(await inviteAs("admin", "late@x.com"));
    await db.prisma.invitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await doAccept(acceptBody(id));
    expect(r.status).toBe(410);
    expect(await json(r)).toEqual({ error: "invite_expired" });
    expect(await db.prisma.user.count({ where: { email: "late@x.com" } })).toBe(0);
    expect((await doAccept(acceptBody("nope"))).status).toBe(404);
    const { id: id2 } = await json(await inviteAs("admin", "short@x.com"));
    expect((await doAccept(acceptBody(id2, { password: "elevenchars" }))).status).toBe(400);
  });

  it("an email that already has a user is 409 user_exists, and the invite stays pending", async () => {
    await db.prisma.user.create({ data: { id: "ghost", name: "G", email: "ghost@x.com" } });
    const elsewhere = await db.prisma.workspace.create({ data: { name: "E", slug: "e-ghost" } });
    await db.prisma.member.create({
      data: { id: "m-ghost", workspaceId: elsewhere.id, userId: "ghost", role: "member" },
    });
    const { id } = await json(await inviteAs("admin", "ghost@x.com"));
    const r = await doAccept(acceptBody(id));
    expect(r.status).toBe(409);
    expect(await json(r)).toEqual({ error: "user_exists" });
    expect((await db.prisma.invitation.findUniqueOrThrow({ where: { id } })).status).toBe(
      "pending",
    );
  });

  it("two concurrent accepts make one user", async () => {
    const { id } = await json(await inviteAs("admin", "race@x.com", "viewer"));
    const rs = await Promise.all([doAccept(acceptBody(id)), doAccept(acceptBody(id))]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.prisma.user.count({ where: { email: "race@x.com" } })).toBe(1);
    expect(await db.prisma.member.count({ where: { user: { email: "race@x.com" } } })).toBe(1);
  });

  it("a MEMBER or VIEWER cannot invite (403); an API key is 401; owner is not an invitable role; cancel works", async () => {
    expect((await inviteAs("member", "m@x.com")).status).toBe(403);
    expect((await inviteAs("viewer", "v@x.com")).status).toBe(403);
    const keyed = await invites.POST(
      req(
        "POST",
        "/api/v1/invites",
        { email: "k@x.com", role: "member" },
        { authorization: `Bearer rn_abcdefgh_${"a".repeat(32)}` },
      ),
    );
    expect(keyed.status).toBe(401);
    expect((await inviteAs("admin", "o@x.com", "owner")).status).toBe(400);
    const { id } = await json(await inviteAs("admin", "cancel@x.com"));
    const del = (who: string) =>
      invite.DELETE(req("DELETE", `/api/v1/invites/${id}`, undefined, as(who)), p(id));
    expect((await del("member")).status).toBe(403);
    expect((await del("admin")).status).toBe(200);
    expect((await doAccept(acceptBody(id))).status).toBe(409); // canceled = not pending
    expect(await auditActions()).toContain("member.invite_cancel");
  });

  it("accept is limited per IP: the 11th in 15 minutes is 429", async () => {
    for (let i = 0; i < 10; i++) expect((await doAccept(acceptBody("nope"))).status).toBe(404);
    const r = await doAccept(acceptBody("nope"));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });
});

describe("members", () => {
  it("lists members; a VIEWER may read but not write", async () => {
    const j = await json(await members.GET(req("GET", "/api/v1/members", undefined, as("viewer"))));
    expect(j.members.map((m: { email: string }) => m.email)).toContain("owner@x.io");
    expect((await patchRole("viewer", "m-member", "viewer")).status).toBe(403);
    expect((await removeAs("viewer", "m-member")).status).toBe(403);
  });

  it("the OWNER's role cannot change or be removed; nobody removes themselves", async () => {
    const patch = await patchRole("admin", ownerMember, "member");
    expect(patch.status).toBe(409);
    expect(await json(patch)).toEqual({ error: "owner_immutable" });
    const del = await removeAs("admin", ownerMember);
    expect(del.status).toBe(409);
    expect(await json(del)).toEqual({ error: "owner_immutable" });
    const self = await removeAs("admin", "m-admin");
    expect(self.status).toBe(409);
    expect(await json(self)).toEqual({ error: "cannot_remove_self" });
    expect((await removeAs("owner", ownerMember)).status).toBe(409);
    expect(await db.prisma.member.count({ where: { role: "owner" } })).toBe(1);
  });

  it("an ADMIN changes a role (audited); owner and unknown roles are 400; another workspace's member is 404", async () => {
    await mkUser("rolechange", "member");
    expect((await patchRole("admin", "m-rolechange", "viewer")).status).toBe(200);
    expect((await db.prisma.member.findUniqueOrThrow({ where: { id: "m-rolechange" } })).role).toBe(
      "viewer",
    );
    expect(
      await db.prisma.auditLog.findFirstOrThrow({ where: { action: "member.role" } }),
    ).toMatchObject({ target: "m-rolechange", meta: { from: "member", to: "viewer" } });
    for (const role of ["owner", "root"])
      expect((await patchRole("admin", "m-rolechange", role)).status).toBe(400);
    const other = await db.prisma.workspace.create({ data: { name: "B", slug: "b-members" } });
    await db.prisma.member.create({
      data: { id: "m-foreign", workspaceId: other.id, userId: "u-member", role: "member" },
    });
    expect((await patchRole("admin", "m-foreign", "admin")).status).toBe(404);
    expect((await removeAs("admin", "m-foreign")).status).toBe(404);
    await db.prisma.member.delete({ where: { id: "m-foreign" } });
  });

  it("removing a member revokes the API keys they created, ends their access and audits member.remove", async () => {
    await mkUser("temp", "admin");
    const newKey = async (who: string) =>
      json(
        await apiKeys.POST(
          req("POST", "/api/v1/api-keys", { name: who, scopes: ["leads:read"] }, as(who)),
        ),
      );
    const made = await newKey("temp");
    const keep = await newKey("admin");
    expect((await db.prisma.apiKey.findUniqueOrThrow({ where: { id: made.id } })).createdById).toBe(
      "u-temp",
    );
    expect((await removeAs("owner", "m-temp")).status).toBe(200);
    expect(
      (await db.prisma.apiKey.findUniqueOrThrow({ where: { id: made.id } })).revokedAt,
    ).not.toBeNull();
    expect(
      (await db.prisma.apiKey.findUniqueOrThrow({ where: { id: keep.id } })).revokedAt,
    ).toBeNull();
    expect(await db.prisma.member.count({ where: { id: "m-temp" } })).toBe(0);
    expect(await db.prisma.user.count({ where: { id: "u-temp" } })).toBe(0); // the address can be invited again
    expect((await members.GET(req("GET", "/api/v1/members", undefined, as("temp")))).status).toBe(
      401,
    );
    expect(
      await db.prisma.auditLog.count({ where: { action: "member.remove", target: "m-temp" } }),
    ).toBe(1);
  });
});

describe("fix round 1", () => {
  it("C1: no audit row or audit API response ever carries an invitation id; a MEMBER cannot list invites", async () => {
    const { id } = await json(await inviteAs("admin", "secret-invite@x.com"));
    const { id: cancelled } = await json(await inviteAs("admin", "cancelled-invite@x.com"));
    await invite.DELETE(
      req("DELETE", `/api/v1/invites/${cancelled}`, undefined, as("admin")),
      p(cancelled),
    );
    const rows = JSON.stringify(await db.prisma.auditLog.findMany());
    expect(rows).not.toContain(id);
    expect(rows).not.toContain(cancelled);
    expect(rows).toContain("secret-invite@x.com"); // the invited email is the target
    const audits = await import("../app/api/v1/audit-logs/route");
    const body = await (
      await audits.GET(req("GET", "/api/v1/audit-logs?take=100", undefined, as("member")))
    ).text();
    expect(body).not.toContain(id);
    expect((await invites.GET(req("GET", "/api/v1/invites", undefined, as("member")))).status).toBe(
      403,
    );
    expect((await invites.GET(req("GET", "/api/v1/invites", undefined, as("viewer")))).status).toBe(
      403,
    );
  });

  it("I1: the migration backfills ApiKey.createdById from the apikey.create audit rows", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = join(__dirname, "../../../packages/db/prisma/migrations");
    const name = readdirSync(dir).find((d) => d.endsWith("_two_factor"))!;
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    const update = sql.split(";").find((s) => /UPDATE "ApiKey"/.test(s));
    expect(update, "backfill statement").toBeTruthy();
    const k = await db.prisma.apiKey.create({
      data: { workspaceId, name: "old", prefix: "p", hash: "h-old-key", scopes: ["leads:read"] },
    });
    await db.prisma.auditLog.create({
      data: { workspaceId, actorId: "u-admin", action: "apikey.create", target: k.id },
    });
    await db.prisma.$executeRawUnsafe(update!);
    expect((await db.prisma.apiKey.findUniqueOrThrow({ where: { id: k.id } })).createdById).toBe(
      "u-admin",
    );
  });

  it("I2: a failing removeMember leaves the keys revoked and an audit row; a retry then completes", async () => {
    await mkUser("flaky", "member");
    const k = await db.prisma.apiKey.create({
      data: {
        workspaceId,
        name: "f",
        prefix: "p",
        hash: "h-flaky",
        scopes: ["leads:read"],
        createdById: "u-flaky",
      },
    });
    const spy = vi.spyOn(auth.api, "removeMember").mockRejectedValueOnce(new Error("boom"));
    expect((await removeAs("owner", "m-flaky")).status).toBe(500);
    spy.mockRestore();
    expect(
      (await db.prisma.apiKey.findUniqueOrThrow({ where: { id: k.id } })).revokedAt,
    ).not.toBeNull();
    expect(
      await db.prisma.auditLog.count({ where: { action: "member.remove", target: "m-flaky" } }),
    ).toBe(1);
    expect(await db.prisma.member.count({ where: { id: "m-flaky" } })).toBe(1);
    expect((await removeAs("owner", "m-flaky")).status).toBe(200);
    expect(await db.prisma.member.count({ where: { id: "m-flaky" } })).toBe(0);
    expect(await db.prisma.user.count({ where: { id: "u-flaky" } })).toBe(0);
  });

  it("I3: a removed member's past actions are labelled with their email, not 'system'", async () => {
    const { actorLabels } = await import("@rightnow/core");
    await mkUser("leaver", "member"); // the sign-in is audited under u-leaver
    await removeAs("owner", "m-leaver");
    const row = await db.prisma.auditLog.findFirstOrThrow({
      where: { action: "member.remove", target: "m-leaver" },
    });
    expect(row.meta).toMatchObject({ email: "leaver@x.io", userId: "u-leaver" });
    const labels = await actorLabels(db.prisma, workspaceId, ["u-leaver", "u-unknown", null]);
    expect(labels.get("u-leaver")).toBe("removed user (leaver@x.io)");
    expect(labels.get("u-unknown")).toBe("removed user (u-unknown)");
    expect(labels.has("null")).toBe(false);
  });

  it("scrub: the migration removes invitation ids from old-shape audit rows", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = join(__dirname, "../../../packages/db/prisma/migrations");
    const name = readdirSync(dir).find((d) => d.endsWith("_two_factor"))!;
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    const stmts = sql.split(";").filter((s) => /UPDATE "AuditLog"/.test(s));
    expect(stmts).toHaveLength(3);
    const inv = await db.prisma.invitation.create({
      data: {
        id: "OLDINVITEID1234567890",
        workspaceId,
        email: "old@x.com",
        role: "member",
        expiresAt: new Date(Date.now() + 1e6),
        inviterId: "u-admin",
      },
    });
    const mk = (action: string, target: string | null, meta?: object) =>
      db.prisma.auditLog.create({ data: { workspaceId, action, target, meta } });
    await mk("member.invite", inv.id, { email: "old@x.com", role: "member" });
    await mk("member.invite_cancel", inv.id);
    await mk("member.invite_cancel", "GONEINVITEID999"); // its invitation no longer exists
    for (const s of stmts) await db.prisma.$executeRawUnsafe(s);
    const rows = await db.prisma.auditLog.findMany({
      where: { action: { in: ["member.invite", "member.invite_cancel"] } },
    });
    expect(JSON.stringify(rows)).not.toMatch(/OLDINVITEID|GONEINVITEID/);
    expect(rows.every((r) => r.target === null || r.target.includes("@"))).toBe(true);
    expect(
      rows.find((r) => r.meta && "role" in (r.meta as object) && r.target === "old@x.com")?.meta,
    ).toEqual({ role: "member" });
  });

  it("an orphan user (removal stopped after removeMember) no longer blocks a new invite", async () => {
    await db.prisma.user.create({ data: { id: "orphan", name: "O", email: "orphan@x.com" } });
    const { id } = await json(await inviteAs("admin", "orphan@x.com"));
    expect((await doAccept(acceptBody(id))).status).toBe(200);
    expect(await db.prisma.user.count({ where: { email: "orphan@x.com" } })).toBe(1);
    expect(await db.prisma.user.count({ where: { id: "orphan" } })).toBe(0);
    expect(await db.prisma.member.count({ where: { user: { email: "orphan@x.com" } } })).toBe(1);
  });
});
