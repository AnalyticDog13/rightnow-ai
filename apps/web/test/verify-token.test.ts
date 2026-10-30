import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "s".repeat(24);
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let verify: typeof import("../app/api/setup/verify-token/route");
let setup: typeof import("../app/api/setup/route");

const req = (path: string, body: unknown, ip: number) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-real-ip": `198.51.100.${ip}`,
    },
    body: JSON.stringify(body),
  });
const check = (token: string, ip: number) =>
  verify.POST(req("/api/setup/verify-token", { token }, ip));
/** 900 s windows are minute-aligned: start early in a minute so a block never straddles an edge. */
const freshWindow = async () => {
  const into = Date.now() % 60_000;
  if (into > 40_000) await new Promise((r) => setTimeout(r, 60_000 - into + 500));
};

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-web-verify-")),
    MODE: "vps", // per-IP buckets via X-Real-IP, so each test gets its own budget
  });
  delete process.env.MAIL_PROVIDER_FAKE;
  (await import("@rightnow/core")).resetEnvCache();
  (await import("../lib/env")).resetWebEnvCache();
  verify = await import("../app/api/setup/verify-token/route");
  setup = await import("../app/api/setup/route");
});
afterAll(() => db.drop());

describe("POST /api/setup/verify-token", () => {
  it("right token -> 200 ok; wrong token -> 403 that never echoes the token", async () => {
    const ok = await check(TOKEN, 1);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const bad = await check("guess-guess-guess-123", 1);
    expect(bad.status).toBe(403);
    const text = await bad.text();
    expect(text).toContain("Invalid setup token");
    expect(text).not.toContain("guess-guess");
    expect(text).not.toContain(TOKEN);
  });

  it("shares the setup bucket: 5 checks + 5 setups use it up, then both are 429", async () => {
    await freshWindow();
    const body = {
      name: "N",
      email: "n@x.io",
      password: "correct horse battery",
      workspaceName: "W",
      token: "wrong-token-123456",
    };
    for (let i = 0; i < 5; i++) {
      expect((await check("wrong-token-123456", 2)).status).toBe(403);
      expect((await setup.POST(req("/api/setup", body, 2))).status).toBe(403);
    }
    const r = await check(TOKEN, 2); // even the right token is refused once the budget is spent
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect((await setup.POST(req("/api/setup", body, 2))).status).toBe(429);
  });

  it("409 once an owner exists", async () => {
    await createFirstOwner(
      db.prisma,
      {
        name: "O",
        email: "o@x.io",
        password: "correct horse battery",
        workspaceName: "A",
        token: TOKEN,
      },
      TOKEN,
    );
    const r = await check(TOKEN, 3);
    expect(r.status).toBe(409);
    expect(await r.text()).not.toContain(TOKEN);
  });
});
