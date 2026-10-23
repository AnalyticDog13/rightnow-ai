import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetEnvCache } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedCampaign } from "../../../packages/core/test/campaign-fixture";
import { startWorker } from "../src/boss";
import { jobs } from "../src/jobs";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local", // vitest sets MODE=test
    DATABASE_URL: db.url,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    APP_URL: "https://app.example.com",
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "browser-closed-")),
  });
  resetEnvCache();
});
afterAll(async () => {
  resetEnvCache();
  await db.drop();
});

test("plan, dispatch, recovery, mail sync and event dispatch are sent once at boot, besides their cron", () => {
  expect(jobs.filter((j) => j.boot).map((j) => [j.name, j.cron])).toEqual([
    ["campaign-plan", "* * * * *"],
    ["campaign-dispatch", "* * * * *"],
    ["send-recovery", "*/5 * * * *"],
    ["mail-sync", "* * * * *"],
    ["event-dispatch", "* * * * *"],
  ]);
});

test("E2E #16 (worker part): with no web server, the worker alone sends 2 leads within 90 s", async () => {
  const P = db.prisma;
  // gaps 0 and an any-time schedule (fixture defaults); leads enrolled, nothing planned yet
  const s = await seedCampaign(P, { at: new Date(), leads: 2, accounts: [{ minGapSec: 0 }] });
  await P.campaignLead.updateMany({
    where: { campaignId: s.campaign.id },
    data: { state: "QUEUED" },
  });
  const w = await startWorker({ databaseUrl: db.url, healthPort: 0 });
  try {
    await expect
      .poll(() => P.scheduledMessage.count({ where: { status: "SENT" } }), {
        timeout: 90_000,
        interval: 500,
      })
      .toBe(2);
  } finally {
    await w.stop();
  }
}, 120_000);
