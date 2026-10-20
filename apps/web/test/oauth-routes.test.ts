import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let start: typeof import("../app/api/v1/oauth/[provider]/start/route");
let callback: typeof import("../app/api/v1/oauth/[provider]/callback/route");
let sessions: typeof import("../app/api/v1/oauth/sessions/[id]/route");
const params = (o: Record<string, string>) => ({ params: Promise.resolve(o) });
const post = (headers: Record<string, string> = {}) =>
  start.POST(
    new Request(`${ORIGIN}/api/v1/oauth/google/start`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...headers },
      body: "{}",
    }),
    params({ provider: "google" }),
  );
const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });

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
  delete process.env.GOOGLE_CLIENT_ID;
  const { auth } = await import("../lib/auth");
  start = await import("../app/api/v1/oauth/[provider]/start/route");
  callback = await import("../app/api/v1/oauth/[provider]/callback/route");
  sessions = await import("../app/api/v1/oauth/sessions/[id]/route");
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

describe("oauth routes", () => {
  it("a MEMBER cannot start a connection", async () => {
    await setRole("member");
    expect((await post()).status).toBe(403);
    await setRole("owner");
  });

  it("is 412 not_configured without Google credentials", async () => {
    const res = await post();
    expect(res.status).toBe(412);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });

  it("blocks a cross-origin POST", async () => {
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
  });

  it("with the fake provider: start, callback, poll once", async () => {
    process.env.MAIL_PROVIDER_FAKE = "1";
    const { resetEnvCache } = await import("@rightnow/core");
    resetEnvCache();
    const res = await post();
    expect(res.status).toBe(200);
    const s = (await res.json()) as { sessionId: string; authUrl: string };
    const cb = new URL(s.authUrl);
    expect(cb.origin + cb.pathname).toBe(`${ORIGIN}/api/v1/oauth/google/callback`);

    await setRole("viewer");
    const poll = () =>
      sessions.GET(
        new Request(`${ORIGIN}/api/v1/oauth/sessions/${s.sessionId}`, { headers: { cookie } }),
        params({ id: s.sessionId }),
      );
    expect(await (await poll()).json()).toEqual({ status: "pending" }); // a VIEWER may poll
    await setRole("owner");

    const page = await callback.GET(
      new Request(cb, { headers: { cookie } }),
      params({ provider: "google" }),
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const done = (await (await poll()).json()) as { status: string; accountId: string };
    expect(done.status).toBe("success");
    expect((await poll()).status).toBe(404);
    expect(await db.prisma.emailAccount.count({ where: { id: done.accountId, workspaceId } })).toBe(
      1,
    );
    delete process.env.MAIL_PROVIDER_FAKE;
    resetEnvCache();
  });

  it("DELETE cancels a pending session: the callback is rejected and the poll is 404", async () => {
    process.env.MAIL_PROVIDER_FAKE = "1";
    const { resetEnvCache } = await import("@rightnow/core");
    resetEnvCache();
    const s = (await (await post()).json()) as { sessionId: string; authUrl: string };
    const del = await sessions.DELETE(
      new Request(`${ORIGIN}/api/v1/oauth/sessions/${s.sessionId}`, {
        method: "DELETE",
        headers: { cookie, origin: ORIGIN },
      }),
      params({ id: s.sessionId }),
    );
    expect(del.status).toBe(200);
    const page = await callback.GET(
      new Request(s.authUrl, { headers: { cookie } }),
      params({ provider: "google" }),
    );
    expect(page.status).toBe(200); // the page always closes the popup, nothing is connected
    expect(await db.prisma.oAuthSession.count({ where: { id: s.sessionId } })).toBe(0);
    delete process.env.MAIL_PROVIDER_FAKE;
    resetEnvCache();
  });
});
