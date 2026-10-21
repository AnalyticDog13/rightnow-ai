import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock, resetEnvCache } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { afterAll, beforeAll, expect, test } from "vitest";
import { campaignDispatch, campaignDispatchJob } from "../src/jobs/campaign-dispatch";
import { jobs } from "../src/jobs";

let db: Awaited<ReturnType<typeof createTestDb>>;
const env = {
  SYNC_MAX_STALENESS_SEC: 300,
  APP_URL: "https://app.example.com",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  MAIL_PROVIDER_FAKE: "1" as const,
};
beforeAll(async () => {
  db = await createTestDb();
  // createProvider reads the process env: the Fake only (D17 / MAIL_PROVIDER_FAKE)
  Object.assign(process.env, {
    MODE: "local", // vitest sets MODE=test
    DATABASE_URL: db.url,
    ENCRYPTION_KEY: env.ENCRYPTION_KEY,
    APP_URL: env.APP_URL,
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "dispatch-job-")),
  });
  resetEnvCache();
});
afterAll(async () => {
  resetEnvCache();
  await db.drop();
});

const T = new Date("2026-10-20T10:00:00Z");

test("campaign-dispatch is registered every minute with a stately queue", () => {
  expect(campaignDispatchJob).toMatchObject({
    name: "campaign-dispatch",
    cron: "* * * * *",
    options: { policy: "stately", retryLimit: 0 },
  });
  expect(jobs).toContain(campaignDispatchJob);
});

test("one tick sends a due row through the Fake and records it SENT", async () => {
  const P = db.prisma;
  const ws = await P.workspace.create({
    data: { name: "W", slug: "w-dispatch-job", physicalAddress: "1 Main St" },
  });
  const a = await P.emailAccount.create({
    data: {
      workspaceId: ws.id,
      provider: "SMTP",
      email: "s@dispatch.test",
      fromName: "S",
      firstName: "S",
      lastName: "T",
      capTier: "SMTP",
      providerCap: 100,
      dailyLimit: 5,
      lastSyncCompletedAt: T,
      nextSendAt: new Date(0),
    },
  });
  const c = await P.campaign.create({
    data: { workspaceId: ws.id, name: "c", status: "ACTIVE", minGapSec: 0, randomGapSec: 0 },
  });
  await P.campaignAccount.create({ data: { campaignId: c.id, accountId: a.id } });
  await P.campaignSchedule.create({
    data: { campaignId: c.id, name: "s", timezone: "UTC", days: 127, from: "00:00", to: "24:00" },
  });
  const st = await P.sequenceStep.create({ data: { campaignId: c.id, order: 1, delayValue: 0 } });
  const v = await P.stepVariant.create({
    data: { stepId: st.id, label: "A", subject: "Hi", body: "Hello" },
  });
  const lead = await P.lead.create({ data: { workspaceId: ws.id, email: "l@lead.test" } });
  const cl = await P.campaignLead.create({
    data: {
      workspaceId: ws.id,
      campaignId: c.id,
      leadId: lead.id,
      state: "ACTIVE",
      currentStepId: st.id,
    },
  });
  await P.scheduledMessage.create({
    data: {
      workspaceId: ws.id,
      campaignId: c.id,
      campaignLeadId: cl.id,
      stepId: st.id,
      variantId: v.id,
      accountId: a.id,
      dueAt: T,
      idempotencyKey: `${cl.id}:${st.id}`,
      renderedSubject: "Hi",
      renderedBody: "Hello",
      renderedText: "Hello",
    },
  });
  expect(await campaignDispatch(P, fixedClock(T), "boot-1", env)).toMatchObject({ SENT: 1 });
  expect(await P.scheduledMessage.findFirstOrThrow()).toMatchObject({
    status: "SENT",
    claimBootId: "boot-1",
  });
  expect(await getFakeProvider(a.email).sentRaw()).toHaveLength(1);
});
