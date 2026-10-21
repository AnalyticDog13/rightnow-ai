import { randomBytes } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fixedClock } from "../../src/clock";
import { claimDue } from "../../src/dispatch";
import { advanceLead, planDue } from "../../src/planner";
import { commitUsage } from "../../src/quota";
import { unsubscribeKeys } from "../../src/unsubscribe";
import { markFresh, seedCampaign } from "../campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const env = {
  appUrl: "https://app.example.com",
  unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
};

// E2E #7: 3 accounts, 60 leads, 2 steps; every simulated 10 minutes: mark fresh, plan, claim, commit (+ advanceLead).
test("rotation over simulated days: even per-account sends; a paused account's step-1 rows move, its follow-ups wait", async () => {
  const start = new Date("2026-10-19T00:00:00Z"); // Monday
  const acct = { dailyLimit: 25, minGapSec: 1800, randomGapSec: 0 };
  const s = await seedCampaign(db.prisma, {
    at: start,
    leads: 60,
    steps: 2,
    accounts: [acct, acct, acct],
    schedules: [{ timezone: "UTC", days: 127, from: "09:00", to: "17:00" }],
  });
  const P = db.prisma;
  await P.campaignLead.updateMany({
    where: { campaignId: s.campaign.id },
    data: { state: "QUEUED", currentStepId: null },
  });
  const [A, B, C] = s.accounts.map((a) => a.id) as [string, string, string];
  const ids = [A, B, C];
  const clock = fixedClock(start);
  const sends = new Map<string, Record<string, number>>();
  let movedFromB: string[] = [];
  for (let tick = 0; tick < 3 * 144; tick++) {
    const now = clock.now();
    const day = now.toISOString().slice(0, 10);
    if (tick === 144) {
      // day 2, 00:00: B is paused; remember its step-1 rows still waiting
      movedFromB = (
        await P.scheduledMessage.findMany({
          where: { accountId: B, status: "SCHEDULED", stepId: s.steps[0]!.id },
        })
      ).map((r) => r.id);
      await P.emailAccount.update({ where: { id: B }, data: { lifecycle: "PAUSED" } });
    }
    await markFresh(P, ids, now);
    await planDue(P, clock, { stalenessSec: 300, sendableProviders: ["SMTP"], env });
    const got = await claimDue(P, clock, {
      limit: 50,
      bootId: "e2e",
      stalenessSec: 300,
      sendableProviders: ["SMTP"],
      random: () => 0,
    });
    for (const c of got)
      await P.$transaction(async (tx) => {
        await tx.scheduledMessage.updateMany({
          where: { id: c.id, status: "SENDING", claimToken: c.claimToken },
          data: { status: "SENT", sentAt: now },
        });
        await commitUsage(tx, c);
        await advanceLead(tx, clock, {
          campaignLeadId: c.campaignLeadId,
          stepId: c.stepId,
          sentAt: now,
        });
        const d = (sends.get(day) ?? { [A]: 0, [B]: 0, [C]: 0 })!;
        d[c.accountId]! += 1;
        sends.set(day, d);
      });
    clock.advance(10 * 60_000);
  }
  const days = [...sends.keys()].sort();
  expect(days).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
  const d1 = sends.get(days[0]!)!;
  expect(Math.max(d1[A]!, d1[B]!, d1[C]!) - Math.min(d1[A]!, d1[B]!, d1[C]!)).toBeLessThanOrEqual(
    1,
  );
  expect(d1[A]).toBeGreaterThan(0);
  for (const d of days.slice(1)) {
    const x = sends.get(d)!;
    expect(x[B]).toBe(0);
    expect(Math.abs(x[A]! - x[C]!)).toBeLessThanOrEqual(1);
    expect(x[A]).toBeGreaterThan(0);
  }
  // B's waiting step-1 rows moved to A and C (same rows, re-routed); its follow-ups wait on B
  expect(movedFromB.length).toBeGreaterThan(0);
  const moved = await P.scheduledMessage.findMany({ where: { id: { in: movedFromB } } });
  expect(moved.every((r) => r.accountId === A || r.accountId === C)).toBe(true);
  expect(new Set(moved.map((r) => r.accountId)).size).toBe(2);
  const bFollow = await P.scheduledMessage.findMany({
    where: { stepId: s.steps[1]!.id, accountId: B },
  });
  expect(bFollow.length).toBeGreaterThan(0);
  expect(bFollow.every((r) => r.status === "SCHEDULED")).toBe(true);
  // never two rows for one (lead, step)
  const all = await P.scheduledMessage.findMany({ where: { campaignId: s.campaign.id } });
  expect(new Set(all.map((r) => `${r.campaignLeadId}:${r.stepId}`)).size).toBe(all.length);
}, 600_000);
