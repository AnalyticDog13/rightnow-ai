import type { PrismaClient } from "@rightnow/db/client";

const windowOf = (windowSec: number, now: Date) =>
  new Date(now.getTime() - (now.getTime() % (windowSec * 1000)));

/**
 * D49: one fixed-window counter per key, bumped by a single atomic upsert, so parallel hits never pass more than `max`.
 * A burst of up to 2x `max` is possible across a window edge (documented). No network call; the caller holds no lock.
 */
export async function hit(
  db: PrismaClient,
  key: string,
  max: number,
  windowSec: number,
  now: Date,
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const start = windowOf(windowSec, now);
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${start}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  if (row!.count <= max) return { ok: true, retryAfterSec: 0 };
  return {
    ok: false,
    retryAfterSec: Math.max(
      1,
      Math.ceil((start.getTime() + windowSec * 1000 - now.getTime()) / 1000),
    ),
  };
}

/** Gives back one hit of the window `now` falls in (R20: the sign-in email bucket counts only failed attempts). */
export async function release(db: PrismaClient, key: string, windowSec: number, now: Date) {
  await db.$executeRaw`
    UPDATE "RateLimitBucket" SET "count" = "count" - 1
    WHERE "key" = ${key} AND "windowStart" = ${windowOf(windowSec, now)} AND "count" > 0`;
}
