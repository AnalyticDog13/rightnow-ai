import { randomBytes } from "node:crypto";
import { fixedClock } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { campaignPlan, campaignPlanJob } from "../src/jobs/campaign-plan";
import { jobs } from "../src/jobs";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const env = {
  SYNC_MAX_STALENESS_SEC: 300,
  APP_URL: "https://app.example.com",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  MAIL_PROVIDER_FAKE: "1" as const,
};

test("campaign-plan is registered every minute with a stately queue", () => {
  expect(campaignPlanJob).toMatchObject({
    name: "campaign-plan",
    cron: "* * * * *",
    options: { policy: "stately", retryLimit: 0 },
  });
  expect(jobs).toContain(campaignPlanJob);
});

test("one tick plans a QUEUED lead of an ACTIVE campaign", async () => {
  const P = db.prisma;
  const ws = await P.workspace.create({
    data: { name: "W", slug: "w-plan-job", physicalAddress: "1 Main St" },
  });
  const a = await P.emailAccount.create({
    data: {
      workspaceId: ws.id,
      provider: "SMTP",
      email: "s@send.test",
      fromName: "S",
      firstName: "S",
      lastName: "T",
      capTier: "SMTP",
      providerCap: 100,
      dailyLimit: 5,
      lastSyncCompletedAt: T,
    },
  });
  const c = await P.campaign.create({ data: { workspaceId: ws.id, name: "c", status: "ACTIVE" } });
  await P.campaignAccount.create({ data: { campaignId: c.id, accountId: a.id } });
  await P.campaignSchedule.create({
    data: { campaignId: c.id, name: "s", timezone: "UTC", days: 127, from: "00:00", to: "24:00" },
  });
  const st = await P.sequenceStep.create({ data: { campaignId: c.id, order: 1, delayValue: 0 } });
  await P.stepVariant.create({ data: { stepId: st.id, label: "A", subject: "Hi", body: "Hello" } });
  const lead = await P.lead.create({ data: { workspaceId: ws.id, email: "l@lead.test" } });
  await P.campaignLead.create({ data: { workspaceId: ws.id, campaignId: c.id, leadId: lead.id } });
  expect(await campaignPlan(P, fixedClock(T), env)).toMatchObject({ planned: 1 });
  expect(await P.scheduledMessage.findMany()).toEqual([
    expect.objectContaining({ accountId: a.id, stepId: st.id, status: "SCHEDULED" }),
  ]);
});
