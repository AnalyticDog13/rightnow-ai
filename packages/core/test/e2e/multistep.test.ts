import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fixedClock } from "../../src/clock";
import { planDue } from "../../src/planner";
import { recoverExpired, resolveUncertain } from "../../src/recovery";
import { dispatchTick } from "../../src/sender";
import { unsubscribeKeys } from "../../src/unsubscribe";
import { markFresh, seedCampaign } from "../campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "multistep-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const env = {
  appUrl: "https://app.example.com",
  unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
};
const fake = (a: { email: string }) => getFakeProvider(a.email);
const DAY = 86_400_000;
const berlin = (d: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Berlin",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { weekday: parts.weekday!, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};

// E2E #5: 3 steps (0 d / 2 d / 3 d), Berlin office hours, 4 leads, 2 accounts, the full worker loop every 20 minutes.
test("multistep over simulated days: 3 messages per lead from its step-1 account, delays, windows, threading", async () => {
  const P = db.prisma;
  const start = new Date("2026-10-19T00:00:00Z"); // Monday
  const s = await seedCampaign(P, {
    at: start,
    leads: 4,
    steps: 3,
    accounts: [{}, {}],
    schedules: [{ timezone: "Europe/Berlin", days: 62, from: "09:00", to: "17:00" }],
  });
  await P.sequenceStep.update({ where: { id: s.steps[1]!.id }, data: { delayValue: 2 } });
  await P.sequenceStep.update({ where: { id: s.steps[2]!.id }, data: { delayValue: 3 } });
  await P.campaignLead.updateMany({
    where: { campaignId: s.campaign.id },
    data: { state: "QUEUED", currentStepId: null },
  });
  const ids = s.accounts.map((a) => a.id);
  const clock = fixedClock(start);
  const deps = { providerFor: fake, env, random: () => 0 };
  for (let t = 0; t < 12 * 72; t++) {
    await markFresh(P, ids, clock.now());
    await planDue(P, clock, { stalenessSec: 300, sendableProviders: ["SMTP"], env });
    await dispatchTick(P, clock, {
      ...deps,
      bootId: "e2e",
      stalenessSec: 300,
      sendableProviders: ["SMTP"],
    });
    await recoverExpired(P, clock, 600);
    await resolveUncertain(P, clock, deps);
    if (
      (await P.campaign.findUniqueOrThrow({ where: { id: s.campaign.id } })).status === "COMPLETED"
    )
      break;
    clock.advance(20 * 60_000);
  }

  const rows = await P.scheduledMessage.findMany({
    where: { campaignId: s.campaign.id },
    include: { step: true },
  });
  expect(rows).toHaveLength(12);
  expect(rows.every((r) => r.status === "SENT")).toBe(true);
  const accounts = new Map(s.accounts.map((a) => [a.id, a]));
  for (const { cl } of s.leads) {
    const mine = rows
      .filter((r) => r.campaignLeadId === cl.id)
      .sort((a, b) => a.step.order - b.step.order);
    expect(mine.map((r) => r.step.order)).toEqual([1, 2, 3]);
    expect(new Set(mine.map((r) => r.accountId)).size).toBe(1); // sticky sender
    const [m1, m2, m3] = mine as [(typeof mine)[0], (typeof mine)[0], (typeof mine)[0]];
    expect(m2.sentAt!.getTime() - m1.sentAt!.getTime()).toBeGreaterThanOrEqual(2 * DAY);
    expect(m3.sentAt!.getTime() - m2.sentAt!.getTime()).toBeGreaterThanOrEqual(3 * DAY);
    for (const m of mine) {
      const b = berlin(m.sentAt!);
      expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(b.weekday);
      expect(b.minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(b.minutes).toBeLessThan(17 * 60);
    }
    const box = fake(accounts.get(m1.accountId)!);
    const got2 = (await box.findSent(m2.rfcMessageId!))!;
    const got3 = (await box.findSent(m3.rfcMessageId!))!;
    expect(got2.inReplyTo).toBe(m1.rfcMessageId);
    expect(got2.references).toEqual([m1.rfcMessageId]);
    expect(got3.inReplyTo).toBe(m2.rfcMessageId);
    expect(got3.references).toEqual([m1.rfcMessageId, m2.rfcMessageId]);
  }
  // exactly 12 copies left the Fake: a duplicate send would not show in the (lead, step)-unique rows
  let copies = 0;
  for (const a of s.accounts) copies += (await fake(a).sentRaw()).length;
  expect(copies).toBe(12);
  const usage = await P.accountDailyUsage.findMany({ where: { accountId: { in: ids } } });
  expect(usage.reduce((n, u) => n + u.sent, 0)).toBe(12);
  expect(usage.every((u) => u.reserved === 0)).toBe(true);
  expect(
    await P.campaignLead.count({
      where: { campaignId: s.campaign.id, state: { not: "COMPLETED" } },
    }),
  ).toBe(0);
  expect((await P.campaign.findUniqueOrThrow({ where: { id: s.campaign.id } })).status).toBe(
    "COMPLETED",
  );
}, 600_000);
