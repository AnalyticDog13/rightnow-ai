import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fixedClock } from "../../src/clock";
import { claimDue } from "../../src/dispatch";
import { commitUsage } from "../../src/quota";
import { markFresh, seedCampaign } from "../campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

// E2E #6: 40 due rows, one account at 10/day, office hours; every simulated minute marks fresh, claims, commits.
test("quota over simulated days: 10 per day, only inside 09:00-17:00, backlog drains on day 4", async () => {
  const start = new Date("2026-10-19T00:00:00Z"); // Monday (M13)
  const s = await seedCampaign(db.prisma, {
    at: start,
    rows: 40,
    accounts: [{ dailyLimit: 10 }],
    schedules: [{ timezone: "UTC", days: 62, from: "09:00", to: "17:00" }],
  });
  const ids = s.accounts.map((a) => a.id);
  const clock = fixedClock(start);
  const sentAt: Date[] = [];
  for (let minute = 0; minute < 4 * 1440; minute++) {
    await markFresh(db.prisma, ids, clock.now());
    const got = await claimDue(db.prisma, clock, {
      limit: 50,
      bootId: "e2e",
      stalenessSec: 300,
      sendableProviders: ["SMTP"],
    });
    for (const c of got)
      await db.prisma.$transaction(async (tx) => {
        await tx.scheduledMessage.updateMany({
          where: { id: c.id, status: "SENDING", claimToken: c.claimToken },
          data: { status: "SENT", sentAt: clock.now() },
        });
        await commitUsage(tx, c);
        sentAt.push(c.claimedAt);
      });
    clock.advance(60_000);
  }
  const perDay = new Map<string, number>();
  for (const t of sentAt) {
    const d = t.toISOString().slice(0, 10);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
    expect(t.getUTCHours()).toBeGreaterThanOrEqual(9);
    expect(t.getUTCHours()).toBeLessThan(17);
  }
  expect(Object.fromEntries(perDay)).toEqual({
    "2026-10-19": 10,
    "2026-10-20": 10,
    "2026-10-21": 10,
    "2026-10-22": 10,
  });
  const usage = await db.prisma.accountDailyUsage.findMany({ orderBy: { day: "asc" } });
  expect(usage.map((u) => [u.sent, u.reserved])).toEqual(Array(4).fill([10, 0]));
  expect(await db.prisma.scheduledMessage.count({ where: { status: "SENT" } })).toBe(40);
}, 600_000);
