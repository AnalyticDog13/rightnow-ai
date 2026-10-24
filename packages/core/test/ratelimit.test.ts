import { randomBytes } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import {
  safeRequest,
  type Diagnostics,
  type MailProvider,
  type SafeResponse,
} from "@rightnow/providers";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { aiComplete, AiRateLimited } from "../src/ai/client";
import { setAiSettings } from "../src/ai/settings";
import { testSmtpConnection } from "../src/accounts/smtp-connect";
import { fixedClock } from "../src/clock";
import { hit, release } from "../src/ratelimit";
import { purgeRetention } from "../src/retention";
import { testEnv } from "./accounts-fixture";

// no network: the AI test answers safeRequest
vi.mock("@rightnow/providers", async (orig) => ({
  ...(await orig<typeof import("@rightnow/providers")>()),
  safeRequest: vi.fn(),
}));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  testEnv();
  db = await createTestDb();
});
afterAll(() => db.drop());

// 10:00:15 -> the 60 s window started at 10:00:00 and has 45 s left
const T = new Date("2026-10-20T10:00:15Z");

test("a fixed window: max hits pass, the next is refused with the seconds left, the next window is fresh", async () => {
  for (let i = 0; i < 5; i++)
    expect(await hit(P(), "k", 5, 60, T)).toEqual({ ok: true, retryAfterSec: 0 });
  expect(await hit(P(), "k", 5, 60, T)).toEqual({ ok: false, retryAfterSec: 45 });
  expect(await hit(P(), "k", 5, 60, new Date(T.getTime() + 45_000))).toEqual({
    ok: true,
    retryAfterSec: 0,
  });
  expect(await hit(P(), "other", 5, 60, T)).toMatchObject({ ok: true }); // keys are independent
});

test("50 concurrent hits with max 10 -> exactly 10 ok", async () => {
  const r = await Promise.all(Array.from({ length: 50 }, () => hit(P(), "burst", 10, 60, T)));
  expect(r.filter((x) => x.ok)).toHaveLength(10);
  const row = await P().rateLimitBucket.findFirstOrThrow({ where: { key: "burst" } });
  expect(row.count).toBe(50);
});

test("release gives one hit back in the same window and never goes below zero", async () => {
  for (let i = 0; i < 3; i++) await hit(P(), "rel", 3, 60, T);
  expect((await hit(P(), "rel", 3, 60, T)).ok).toBe(false);
  await release(P(), "rel", 60, T);
  await release(P(), "rel", 60, T);
  expect((await hit(P(), "rel", 3, 60, T)).ok).toBe(true);
  for (let i = 0; i < 10; i++) await release(P(), "none", 60, T); // no row: nothing happens
  expect(await P().rateLimitBucket.count({ where: { key: "none" } })).toBe(0);
});

test("retention deletes windows older than 1 day", async () => {
  const old = new Date(T.getTime() - 25 * 3600_000);
  await hit(P(), "old", 5, 60, old);
  await hit(P(), "fresh", 5, 60, new Date(T.getTime() - 23 * 3600_000));
  const r = await purgeRetention(P(), fixedClock(T));
  expect(r.rateLimitBuckets).toBeGreaterThanOrEqual(1);
  expect(await P().rateLimitBucket.count({ where: { key: "old" } })).toBe(0);
  expect(await P().rateLimitBucket.count({ where: { key: "fresh" } })).toBe(1);
});

test("AI: 30 calls per minute per workspace; the 31st is AiRateLimited 429 and never reaches the model", async () => {
  const PUBLIC = { allowPrivate: false, resolve: async () => ["93.184.216.34"] };
  const ws = async () => {
    const w = await P().workspace.create({
      data: {
        name: "W",
        slug: `rl-${randomBytes(4).toString("hex")}`,
        physicalAddress: "1 Main St",
      },
    });
    await setAiSettings(
      P(),
      w.id,
      null,
      { baseUrl: "https://llm.example.com/v1", apiKey: "sk-x", model: "m" },
      PUBLIC,
    );
    return w.id;
  };
  let calls = 0;
  vi.mocked(safeRequest).mockImplementation(async (): Promise<SafeResponse> => {
    calls++;
    return {
      status: 200,
      headers: {},
      latencyMs: 1,
      body: Buffer.from(JSON.stringify({ choices: [{ message: { content: "hi" } }] })),
    };
  });
  const a = await ws();
  const b = await ws();
  const clock = fixedClock(T);
  const call = (w: string) =>
    aiComplete(P(), clock, w, "draft", { system: "s", user: "u", maxTokens: 5 }, PUBLIC);
  for (let i = 0; i < 30; i++) await call(a);
  const err = await call(a).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AiRateLimited);
  expect(err).toMatchObject({ status: 429, message: "rate_limited", retryAfterSec: 45 });
  expect(calls).toBe(30);
  await call(b); // another workspace is unaffected
  expect(calls).toBe(31);
});

test("test-connection replies are cut to the first line, 120 characters; commands and banners are dropped", async () => {
  const banner = `554 ${"x".repeat(2048)}\r\nsecond line`;
  const diag: Diagnostics = {
    ok: false,
    checks: [
      { name: "imap_login", ok: true },
      {
        name: "smtp_auth",
        ok: false,
        code: "auth_failed",
        command: "AUTH PLAIN",
        response: banner,
        message: "The server rejected the username or password.",
      },
    ],
  };
  const provider = { diagnostics: async () => diag } as unknown as MailProvider;
  const srv = { host: "smtp.acme.io", port: 587, secure: false, username: "u", password: "p" };
  const d = await testSmtpConnection(
    { providerFor: () => provider },
    { email: "a@acme.io", firstName: "A", lastName: "", imap: srv, smtp: srv },
  );
  const bad = d.checks[1]!;
  expect(Object.keys(bad).sort()).toEqual(["code", "message", "name", "ok", "reply"]);
  expect(bad.reply!.length).toBeLessThanOrEqual(120);
  expect(bad.reply!.startsWith("554 x")).toBe(true);
  expect(JSON.stringify(d)).not.toContain("second line");
  expect(JSON.stringify(d)).not.toContain("AUTH PLAIN");
});
