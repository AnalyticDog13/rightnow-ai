import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { buildMime, getFakeProvider, newMessageId } from "@rightnow/providers";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fixedClock } from "../../src/clock";
import { syncDue } from "../../src/mail/sync";
import { planDue } from "../../src/planner";
import { dispatchTick } from "../../src/sender";
import { unsubscribeKeys } from "../../src/unsubscribe";
import { seedCampaign } from "../campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "reply-sync-"));

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

// E2E #8: the worker's own sync (not a test shortcut) writes freshness, ingests the reply and stops the follow-up.
test("a reply found by syncDue stops that lead's step 2; an unrelated lead's step 2 is sent", async () => {
  const P = db.prisma;
  const clock = fixedClock(new Date("2026-10-20T08:00:00Z"));
  const s = await seedCampaign(P, {
    at: clock.now(),
    leads: 2,
    steps: 2,
    accounts: [{ credentialsEnc: "x", lastSyncCompletedAt: null }],
  });
  await P.campaignLead.updateMany({
    where: { campaignId: s.campaign.id },
    data: { state: "QUEUED", currentStepId: null },
  });
  const A = s.accounts[0]! as EmailAccount;
  const [replier, other] = s.leads as [(typeof s.leads)[0], (typeof s.leads)[0]];
  const tick = async () => {
    await syncDue(P, clock, { providerFor: async (a) => fake(a), env: { SYNC_POLL_SEC: 120 } });
    await planDue(P, clock, { stalenessSec: 300, sendableProviders: ["SMTP"], env });
    await dispatchTick(P, clock, {
      providerFor: fake,
      env,
      random: () => 0,
      bootId: "e2e",
      stalenessSec: 300,
      sendableProviders: ["SMTP"],
    });
  };

  // nothing sends before the first sync completes
  await planDue(P, clock, { stalenessSec: 300, sendableProviders: ["SMTP"], env });
  await dispatchTick(P, clock, {
    providerFor: fake,
    env,
    random: () => 0,
    bootId: "e2e",
    stalenessSec: 300,
    sendableProviders: ["SMTP"],
  });
  expect(await fake(A).sentRaw()).toHaveLength(0);

  await tick();
  expect(
    (await P.emailAccount.findUniqueOrThrow({ where: { id: A.id } })).lastSyncCompletedAt,
  ).toEqual(clock.now());
  expect(await fake(A).sentRaw()).toHaveLength(2);
  const step1 = await P.scheduledMessage.findFirstOrThrow({
    where: { status: "SENT", campaignLeadId: replier.cl.id },
  });

  clock.advance(3600_000);
  await fake(A).receiveRaw(
    await buildMime({
      from: { email: replier.lead.email },
      to: [{ email: A.email }],
      subject: `Re: ${step1.renderedSubject}`,
      text: "Thanks, I will think about it.",
      messageId: newMessageId("lead.test"),
      inReplyTo: step1.rfcMessageId!,
      references: [step1.rfcMessageId!],
      date: clock.now(),
    }),
  );

  for (let t = 0; t < 3 * 24; t++) {
    clock.advance(3600_000);
    await tick();
  }
  expect(await P.campaignLead.findUniqueOrThrow({ where: { id: replier.cl.id } })).toMatchObject({
    state: "STOPPED",
    stopReason: "REPLIED",
  });
  expect(
    await P.scheduledMessage.count({ where: { campaignLeadId: replier.cl.id, status: "SENT" } }),
  ).toBe(1);
  expect(
    await P.scheduledMessage.count({ where: { campaignLeadId: other.cl.id, status: "SENT" } }),
  ).toBe(2);
  expect(await fake(A).sentRaw()).toHaveLength(3);
  // our own sends came back through the Sent folder sync without duplicating their Message rows
  expect(await P.message.count({ where: { accountId: A.id, direction: "OUT" } })).toBe(3);
  expect(await P.message.count({ where: { accountId: A.id, direction: "IN" } })).toBe(1);
}, 300_000);
