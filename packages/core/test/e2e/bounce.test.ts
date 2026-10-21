import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { afterAll, beforeAll, expect, test } from "vitest";
import { fixedClock } from "../../src/clock";
import { classify } from "../../src/mail/classify";
import { ingestMessage } from "../../src/mail/ingest";
import { applyInbound } from "../../src/mail/stoprules";
import { planDue } from "../../src/planner";
import { dispatchTick } from "../../src/sender";
import { unsubscribeKeys } from "../../src/unsubscribe";
import { markFresh, seedCampaign } from "../campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "bounce-"));

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

// E2E #10: a hard-bounce DSN for step 1 suppresses the address and stops the lead; no follow-up leaves the Fake.
test("a hard bounce suppresses the lead: nothing more leaves the Fake", async () => {
  const P = db.prisma;
  const clock = fixedClock(new Date("2026-10-20T08:00:00Z"));
  const s = await seedCampaign(P, { at: clock.now(), leads: 1, steps: 3, accounts: [{}] });
  await P.campaignLead.updateMany({
    where: { campaignId: s.campaign.id },
    data: { state: "QUEUED", currentStepId: null },
  });
  const A = s.accounts[0]! as EmailAccount;
  const { lead, cl } = s.leads[0]!;
  const tick = async () => {
    await markFresh(P, [A.id], clock.now());
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
  await tick();
  expect(await fake(A).sentRaw()).toHaveLength(1);
  const step1 = await P.scheduledMessage.findFirstOrThrow({ where: { status: "SENT" } });

  clock.advance(600_000);
  await fake(A).receiveRaw(
    Buffer.from(
      [
        "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        `To: ${A.email}`,
        "Subject: Delivery Status Notification (Failure)",
        `Date: ${clock.now().toUTCString()}`,
        "Message-ID: <dsn-e2e@mx.test>",
        "MIME-Version: 1.0",
        'Content-Type: multipart/report; report-type=delivery-status; boundary="B1"',
        "",
        "--B1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        `Address not found. Your message wasn't delivered to ${lead.email}.`,
        "",
        "--B1",
        "Content-Type: message/delivery-status",
        "",
        "Reporting-MTA: dns; mx.test",
        "",
        `Final-Recipient: rfc822; ${lead.email}`,
        "Action: failed",
        "Status: 5.1.1",
        "Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.",
        "",
        "--B1",
        "Content-Type: text/rfc822-headers",
        "",
        `From: ${A.email}`,
        `To: ${lead.email}`,
        `Message-ID: ${step1.rfcMessageId}`,
        "",
        "--B1--",
        "",
      ].join("\r\n"),
    ),
  );
  const { messages } = await fake(A).listMessages({ since: new Date(0), folder: "INBOX" });
  for (const m of messages) {
    const c = classify(m, { now: m.date, direction: "IN" });
    await P.$transaction(async (tx) => {
      const r = await ingestMessage(tx, A, m, c, { historical: false });
      if (r.created)
        await applyInbound(tx, clock, {
          workspaceId: s.ws,
          message: await tx.message.findUniqueOrThrow({ where: { id: r.messageId } }),
          classification: c,
          match: r.match,
        });
    });
  }

  for (let t = 0; t < 6 * 24; t++) {
    clock.advance(3600_000);
    await tick();
  }
  expect(await fake(A).sentRaw()).toHaveLength(1);
  expect(await P.campaignLead.findUniqueOrThrow({ where: { id: cl.id } })).toMatchObject({
    state: "STOPPED",
    stopReason: "BOUNCED",
  });
  expect(await P.suppression.findMany({ where: { workspaceId: s.ws } })).toMatchObject([
    { kind: "EMAIL", value: lead.email, reason: "HARD_BOUNCE", source: "dsn" },
  ]);
  expect(
    await P.event.findMany({ where: { workspaceId: s.ws, type: "BOUNCE_HARD" } }),
  ).toMatchObject([{ leadId: lead.id, scheduledMessageId: step1.id }]);
}, 300_000);
