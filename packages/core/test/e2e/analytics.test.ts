import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { buildMime, getFakeProvider, newMessageId } from "@rightnow/providers";
import { afterAll, beforeAll, expect, test } from "vitest";
import { analytics } from "../../src/analytics/metrics";
import { analyticsQuery } from "../../src/analytics/query";
import { fixedClock } from "../../src/clock";
import { startPlacementTest } from "../../src/deliverability/placement";
import { runNextJob } from "../../src/jobs";
import { warmupTick } from "../../src/deliverability/warmup";
import { syncDue } from "../../src/mail/sync";
import { planDue } from "../../src/planner";
import { dispatchTick } from "../../src/sender";
import { unsubscribeKeys } from "../../src/unsubscribe";
import { seedCampaign } from "../campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "analytics-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const env = {
  appUrl: "https://app.example.com",
  unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
};
const FAKE = { MAIL_PROVIDER_FAKE: "1" as const };
const fake = (a: { email: string }) => getFakeProvider(a.email);
const providerFor = async (a: EmailAccount) => fake(a);
const MIN = 60_000;

// E2E #14 (Rev 2 I8, M17): the real send, sync, CRM, warm-up and placement paths feed analytics exactly.
test("analytics counts the real pipeline; warm-up and placement mail never count, placement uses capacity", async () => {
  const P = db.prisma;
  const clock = fixedClock(new Date("2026-10-20T08:00:00Z"));
  const tag = randomBytes(3).toString("hex");
  const s = await seedCampaign(P, {
    at: clock.now(),
    leads: 3,
    steps: 2,
    accounts: [
      {
        email: `a-${tag}@a${tag}.test`,
        credentialsEnc: "x",
        lastSyncCompletedAt: null,
        providerCap: 500,
      },
      {
        email: `b-${tag}@b${tag}.test`,
        credentialsEnc: "x",
        lastSyncCompletedAt: null,
        providerCap: 500,
        placementSeed: true,
      },
    ],
  });
  await P.campaignLead.updateMany({
    where: { campaignId: s.campaign.id },
    data: { state: "QUEUED", currentStepId: null },
  });
  const [A, B] = s.accounts as [EmailAccount, EmailAccount];
  await fake(A).enableDelivery();
  await fake(B).enableDelivery();
  const sync = () =>
    syncDue(P, clock, { providerFor, env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 } });
  const tick = async () => {
    await sync();
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
  for (
    let i = 0;
    i < 6 && (await P.scheduledMessage.count({ where: { status: "SENT" } })) < 3;
    i++
  ) {
    await tick();
    clock.advance(MIN);
  }
  const sent = await P.scheduledMessage.findMany({
    where: { campaignId: s.campaign.id, status: "SENT" },
    include: { campaignLead: true, account: true },
  });
  expect(sent).toHaveLength(3);
  const to = (i: number) => sent.find((m) => m.campaignLead.leadId === s.leads[i]!.lead.id)!;

  // lead 1 replies "Interested" (CRM creates the deal); lead 2's address bounces (5.1.1)
  const r1 = to(0);
  await fake(r1.account).receiveRaw(
    await buildMime({
      from: { email: s.leads[0]!.lead.email },
      to: [{ email: r1.account.email }],
      subject: `Re: ${r1.renderedSubject}`,
      text: "Sounds good, I'm interested. Tell me more.",
      messageId: newMessageId("lead.test"),
      inReplyTo: r1.rfcMessageId!,
      references: [r1.rfcMessageId!],
      date: clock.now(),
    }),
  );
  const r2 = to(1);
  await fake(r2.account).receiveRaw(
    Buffer.from(
      [
        "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        `To: ${r2.account.email}`,
        "Subject: Delivery Status Notification (Failure)",
        `Date: ${clock.now().toUTCString()}`,
        `Message-ID: <dsn-${tag}@mx.test>`,
        "MIME-Version: 1.0",
        'Content-Type: multipart/report; report-type=delivery-status; boundary="B1"',
        "",
        "--B1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        `Your message wasn't delivered to ${s.leads[1]!.lead.email}.`,
        "",
        "--B1",
        "Content-Type: message/delivery-status",
        "",
        "Reporting-MTA: dns; mx.test",
        "",
        `Final-Recipient: rfc822; ${s.leads[1]!.lead.email}`,
        "Action: failed",
        "Status: 5.1.1",
        "Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.",
        "",
        "--B1",
        "Content-Type: text/rfc822-headers",
        "",
        `From: ${r2.account.email}`,
        `To: ${s.leads[1]!.lead.email}`,
        `Message-ID: ${r2.rfcMessageId}`,
        "",
        "--B1--",
        "",
      ].join("\r\n"),
    ),
  );
  clock.advance(5 * MIN);
  await sync();
  expect(await P.opportunity.count({ where: { workspaceId: s.ws } })).toBe(1);

  const q = analyticsQuery.parse({
    from: "2026-10-20",
    to: "2026-10-20",
    campaignIds: s.campaign.id,
  });
  const before = (await analytics(P, s.ws, q)).total;
  expect(before).toMatchObject({
    sent: 3,
    contacted: 3,
    replied: 1,
    hardBounced: 1,
    opportunities: 1,
    rates: { positiveReply: 1 },
  });
  const usage = async () =>
    (
      await P.accountDailyUsage.aggregate({
        where: { accountId: { in: [A.id, B.id] } },
        _sum: { sent: true },
      })
    )._sum.sent;
  expect(await usage()).toBe(3);
  const events = () => P.event.count({ where: { workspaceId: s.ws } });
  const eventsBefore = await events();

  // warm-up between A and B, then a placement test of A with B as the one seed
  for (const [i, a] of [A, B].entries())
    await P.warmupSettings.create({
      data: {
        accountId: a.id,
        workspaceId: s.ws,
        enabled: true,
        slowWarmup: false,
        dailyLimit: 10,
        replyRatePct: 0,
        filterTag: `rn-${tag}${i}xy`,
        startedAt: clock.now(),
      },
    });
  clock.advance(MIN);
  expect((await warmupTick(P, clock, { providerFor, env: FAKE })).sent).toBeGreaterThan(0);
  await startPlacementTest(P, clock, { renderEnv: env, env: FAKE }, s.ws, null, {
    accountId: A.id,
    subject: "Placement",
    body: "Hello there",
  });
  await runNextJob(P, clock, new AbortController().signal, { env: FAKE, providerFor }); // the placement_run job does the sends
  for (let i = 0; i < 3; i++) {
    clock.advance(11 * MIN);
    await sync(); // the warm-up and placement mail reach the other mailbox and its sync
    await warmupTick(P, clock, { providerFor, env: FAKE });
  }
  const warm = await P.warmupMessage.groupBy({
    by: ["kind"],
    where: { workspaceId: s.ws, status: "SENT" },
    _count: true,
  });
  expect(warm.map((w) => w.kind).sort()).toEqual(["PLACEMENT", "SEND"]);
  // the mail really reached the other mailbox (sync saw it, or the locate found it)
  expect(
    await P.warmupMessage.count({ where: { workspaceId: s.ws, landedFolder: { not: null } } }),
  ).toBeGreaterThan(0);

  // M17: placement counts toward capacity (one seed), warm-up never touches usage (D36)
  expect(await usage()).toBe(3 + 1);
  // nothing in any metric moved: warm-up and placement mail never become Events (D36, D37), even unattributed ones
  expect(await events()).toBe(eventsBefore);
  expect((await analytics(P, s.ws, q)).total).toEqual(before);
  expect(
    (await analytics(P, s.ws, analyticsQuery.parse({ from: "2026-10-20", to: "2026-10-20" })))
      .total,
  ).toEqual(before);
}, 300_000);
