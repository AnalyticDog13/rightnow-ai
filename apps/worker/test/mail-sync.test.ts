import type { PrismaClient } from "@rightnow/db/client";
import { expect, test, vi } from "vitest";

const syncDue = vi.fn(async () => ({ synced: 1, failed: 0 }));
vi.mock("@rightnow/core", async (orig) => ({
  ...(await orig<typeof import("@rightnow/core")>()),
  getEnv: () => ({ SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 }),
  syncDue,
}));
const { mailSync } = await import("../src/jobs/mail-sync");

const env = { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 };
const clock = { now: () => new Date() };
const prisma = {} as PrismaClient;

test("D48: one full pass, then push-requested re-checks every pause until the loop ends", async () => {
  const r = await mailSync(prisma, clock, env, undefined, undefined, { ms: 400, pauseMs: 100 });
  const opts = syncDue.mock.calls.map((c) => (c as unknown[])[3] as { requestedOnly?: boolean });
  expect(opts[0]!.requestedOnly).toBeUndefined();
  expect(opts.length).toBeGreaterThanOrEqual(2);
  expect(opts.length).toBeLessThanOrEqual(4);
  expect(opts.slice(1).every((o) => o.requestedOnly === true)).toBe(true);
  expect(r).toEqual({ synced: opts.length, failed: 0 });
});

test("an aborted signal stops the loop after the first pass", async () => {
  syncDue.mockClear();
  const ac = new AbortController();
  ac.abort();
  await mailSync(prisma, clock, env, undefined, ac.signal, { ms: 400, pauseMs: 100 });
  expect(syncDue).toHaveBeenCalledTimes(1);
});
