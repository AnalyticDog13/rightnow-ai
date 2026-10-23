import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount, PrismaClient } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import {
  TransientBeforeSendError,
  buildMime,
  getFakeProvider,
  newMessageId,
} from "@rightnow/providers";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fixedClock } from "../../src/clock";
import { claimDue } from "../../src/dispatch";
import { syncDue } from "../../src/mail/sync";
import { planDue } from "../../src/planner";
import { recoverExpired, resolveUncertain } from "../../src/recovery";
import { dispatchTick } from "../../src/sender";
import { unsubscribeKeys } from "../../src/unsubscribe";
import { seedCampaign } from "../campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "downtime-"));

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STALE_SEC = 300;
const env = {
  appUrl: "https://app.example.com",
  unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
};
const fake = (a: { email: string }) => getFakeProvider(a.email);
const window = { timezone: "UTC", days: 127, from: "09:00", to: "17:00" };
const sendOpts = { stalenessSec: STALE_SEC, sendableProviders: ["SMTP" as const] };

// D's mailbox sync fails on every run after the wake (I12); its expected log lines are kept out of the output
let quiet: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  const error = console.error.bind(console);
  quiet = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    if (!/^sync(Due)?: account/.test(String(a[0]))) error(...a);
  });
});
afterAll(() => quiet.mockRestore());

const sentIds = async (a: { email: string }) =>
  (await fake(a).sentRaw()).map((r) => /^Message-ID:\s*(<[^>\r\n]+>)/im.exec(r.toString())![1]!);

/**
 * PS-SYNC-09..12. Monday 09:00 UTC: step 1 goes out to every lead, two more rows are claimed and left SENDING (one
 * reached the provider, one did not), the laptop sleeps or is switched off for `days`, the mailboxes keep receiving,
 * then it wakes at 09:30 and the worker's jobs run every 10 min inside office hours (hourly outside) for 2 days.
 */
test.each(
  [1, 7, 30].flatMap((days) => (["cold_boot", "sleep"] as const).map((mode) => ({ days, mode }))),
)(
  "downtime $days d ($mode): no send before a fresh sync, none to stopped leads, no burst, none twice",
  async ({ days, mode }) => {
    const db = await createTestDb();
    try {
      await scenario(db.prisma, days, mode);
    } finally {
      await db.drop();
    }
  },
  600_000,
);

async function scenario(P: PrismaClient, days: number, mode: "cold_boot" | "sleep") {
  const start = new Date("2026-10-19T09:00:00Z"); // Monday
  const clock = fixedClock(start);
  const tag = randomBytes(3).toString("hex");
  const live = { credentialsEnc: "x", lastSyncCompletedAt: null, dailyLimit: 100 };

  // main campaign (company stop): L1..L8, M1/M2 (left mid-flight), S0..S24 silent; rows assigned to A/B below
  const s = await seedCampaign(P, {
    at: start,
    steps: 3,
    rows: 35,
    accounts: [live, live],
    schedules: [window],
    campaign: { stopOnReply: true, stopForCompanyOnReply: true },
  });
  const [A, B] = s.accounts as [EmailAccount, EmailAccount];
  const L = s.leads.slice(0, 8);
  const [M1, M2] = [s.leads[8]!, s.leads[9]!];
  const S = s.leads.slice(10);
  const onB = new Set(
    [L[1], L[2], L[5], L[7], M2, ...S.filter((_, i) => i % 2)].map((x) => x!.cl.id),
  );
  for (const [i, r] of s.rows.entries())
    await P.scheduledMessage.update({
      where: { id: r.id },
      data: {
        accountId: onB.has(r.campaignLeadId) ? B.id : A.id,
        ...(i === 8 || i === 9 ? { dueAt: new Date(start.getTime() + 30 * MIN) } : {}),
      },
    });
  // L2 and L3 work at the same company; D26 counts only messages dated at or after enrolment
  const company = `acme-${tag}.test`;
  for (const [i, p] of [L[1]!, L[2]!].entries())
    p.lead = await P.lead.update({
      where: { id: p.lead.id },
      data: { email: `p${i}@${company}`, companyDomain: company },
    });
  await P.campaignLead.updateMany({ where: { workspaceId: s.ws }, data: { enrolledAt: start } });

  // I12: C (healthy) and D (sync fails after the wake) share campaign X (company stop) and Y (no company stop)
  const x = await seedCampaign(P, {
    at: start,
    steps: 2,
    rows: 2,
    accounts: [live, live],
    schedules: [window],
    campaign: { stopForCompanyOnReply: true },
  });
  const [C, D] = x.accounts as [EmailAccount, EmailAccount];
  const y = await seedCampaign(P, {
    at: start,
    workspaceId: x.ws,
    useAccounts: [C, D],
    steps: 2,
    rows: 2,
    schedules: [window],
  });
  await P.campaignLead.updateMany({ where: { workspaceId: x.ws }, data: { enrolledAt: start } });
  const all = [A, B, C, D];

  const broken = new Set<string>();
  const syncDeps = {
    providerFor: async (a: EmailAccount) => {
      if (broken.has(a.id)) throw new TransientBeforeSendError("connect_refused");
      return fake(a);
    },
    env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
  };
  let bootId = "boot-1";
  const dispatch = () =>
    dispatchTick(P, clock, { providerFor: fake, env, random: () => 0, bootId, ...sendOpts });
  const recovery = async () => {
    await recoverExpired(P, clock, 600);
    await resolveUncertain(P, clock, { providerFor: fake });
  };
  const tick = async () => {
    await syncDue(P, clock, syncDeps);
    await recovery();
    await planDue(P, clock, { ...sendOpts, env });
    await dispatch();
  };

  // ---- before the downtime: step 1 to everyone (relaxed limits for the setup only) -----------------------------
  await P.campaign.updateMany({ data: { minGapSec: 0, randomGapSec: 0 } });
  await tick();
  expect((await fake(A).sentRaw()).length + (await fake(B).sentRaw()).length).toBe(33);
  clock.advance(30 * MIN);
  await syncDue(P, clock, syncDeps);
  const mid = await claimDue(P, clock, { limit: 2, bootId, ...sendOpts });
  expect(mid.map((c) => c.campaignLeadId).sort()).toEqual([M1.cl.id, M2.cl.id].sort());
  const m1 = mid.find((c) => c.campaignLeadId === M1.cl.id)!;
  const m2 = mid.find((c) => c.campaignLeadId === M2.cl.id)!;
  // M1 reached the provider, then the machine slept before the result was recorded; M2 never left
  await fake(A).send({
    from: { email: A.email },
    to: [{ email: M1.lead.email }],
    subject: "Hi",
    text: "Hello",
    messageId: m1.rfcMessageId,
    date: clock.now(),
  });
  await P.emailAccount.updateMany({ data: { dailyLimit: 10 } });
  await P.campaign.updateMany({ data: { minGapSec: 600, randomGapSec: 0 } });
  const before = new Map(
    await Promise.all(all.map(async (a) => [a.id, (await sentIds(a)).length] as const)),
  );
  const step1 = async (cl: string) =>
    P.scheduledMessage.findFirstOrThrow({ where: { campaignLeadId: cl, status: "SENT" } });

  // ---- the downtime: the mailboxes keep receiving ------------------------------------------------------------------
  clock.advance((days * DAY) / 2);
  const at = clock.now();
  const reply = async (to: EmailAccount, from: string, text: string, inReplyTo?: string) =>
    fake(to).receiveRaw(
      await buildMime({
        from: { email: from },
        to: [{ email: to.email }],
        subject: inReplyTo ? "Re: Hi" : "Quick question",
        text,
        messageId: newMessageId("lead.test"),
        ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
        date: at,
      }),
    );
  const l1 = await step1(L[0]!.cl.id);
  await reply(A, L[0]!.lead.email, "Thanks, tell me more.", l1.rfcMessageId!);
  await reply(A, L[1]!.lead.email, "Saw your note to my colleague. Can we talk?"); // new message, other mailbox
  const l4 = await step1(L[3]!.cl.id);
  await fake(A).receiveRaw(dsn(A.email, L[3]!.lead.email, l4.rfcMessageId!, at));
  await reply(A, L[4]!.lead.email, "Unsubscribe", (await step1(L[4]!.cl.id)).rfcMessageId!);
  await fake(B).expireCursors(); // Gmail-style history expired: the wake needs a FULL reconcile
  await reply(
    B,
    L[5]!.lead.email,
    "Interesting, call me.",
    (await step1(L[5]!.cl.id)).rfcMessageId!,
  );
  clock.advance((days * DAY) / 2); // wake: 09:30, inside the window, step 2 long due

  // ---- wake -----------------------------------------------------------------------------------------------------------
  broken.add(D.id);
  if (mode === "cold_boot") {
    bootId = "boot-2";
    await recovery();
  }
  // (a) nothing leaves before a fresh sync
  await planDue(P, clock, { ...sendOpts, env });
  await dispatch();
  for (const a of all) expect((await sentIds(a)).length).toBe(before.get(a.id));

  await syncDue(P, clock, syncDeps);
  const wokeAt = clock.now();
  // (b) every stop is in place once the first sync completed
  const reason = async (cl: string) =>
    (await P.campaignLead.findUniqueOrThrow({ where: { id: cl } })).stopReason;
  expect(await Promise.all(L.slice(0, 6).map((l) => reason(l.cl.id)))).toEqual([
    "REPLIED",
    "REPLIED",
    "COMPANY_REPLIED",
    "BOUNCED",
    "UNSUBSCRIBED",
    "REPLIED",
  ]);

  const end = wokeAt.getTime() + 2 * DAY;
  while (clock.now().getTime() < end) {
    await tick();
    const h = clock.now().getUTCHours();
    clock.advance(h >= 8 && h < 18 ? 10 * MIN : HOUR);
  }

  // (b) leads 1-6 got step 1 only, ever
  for (const l of L.slice(0, 6))
    expect(
      await P.scheduledMessage.count({ where: { campaignLeadId: l.cl.id, status: "SENT" } }),
    ).toBe(1);
  // (d) the mid-flight rows: found in Sent → SENT, not found → HELD; neither sent again
  expect(await P.scheduledMessage.findUniqueOrThrow({ where: { id: m1.id } })).toMatchObject({
    status: "SENT",
  });
  expect(await P.scheduledMessage.findUniqueOrThrow({ where: { id: m2.id } })).toMatchObject({
    status: "HELD",
  });
  expect(await sentIds(B)).not.toContain(m2.rfcMessageId);

  // (c) the backlog: L7/L8 get step 2; only inside the window, ≥ 600 s apart, ≤ 10 per account-day, spread over days
  const after = await P.scheduledMessage.findMany({
    where: { workspaceId: s.ws, status: "SENT", sentAt: { gte: wokeAt } },
    include: { step: true, campaignLead: true },
    orderBy: { sentAt: "asc" },
  });
  for (const l of [L[6]!, L[7]!])
    expect(after.some((r) => r.campaignLeadId === l.cl.id && r.step.order === 2)).toBe(true);
  for (const acct of [A, B]) {
    const t = after.filter((r) => r.accountId === acct.id).map((r) => r.sentAt!);
    const perDay = new Map<string, number>();
    for (const [i, d] of t.entries()) {
      expect(d.getUTCHours()).toBeGreaterThanOrEqual(9);
      expect(d.getUTCHours()).toBeLessThan(17);
      if (i) expect(d.getTime() - t[i - 1]!.getTime()).toBeGreaterThanOrEqual(600_000);
      const k = d.toISOString().slice(0, 10);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(10);
    expect(perDay.get(wokeAt.toISOString().slice(0, 10))).toBe(10); // backlog > quota: the day is full...
    expect(perDay.size).toBeGreaterThan(1); // ...and the rest waits for the next days
  }
  // follow-ups leave from the lead's step-1 mailbox
  for (const r of after) expect(r.accountId).toBe(r.campaignLead.accountId);

  // (e) no (campaignLead, step) twice in any mailbox's Sent
  const rows = await P.scheduledMessage.findMany({ where: { rfcMessageId: { not: null } } });
  const byRfc = new Map(rows.map((r) => [r.rfcMessageId!, `${r.campaignLeadId}:${r.stepId}`]));
  for (const a of all) {
    const keys = (await sentIds(a)).map((id) => byRfc.get(id));
    expect(keys).not.toContain(undefined);
    expect(new Set(keys).size).toBe(keys.length);
  }

  // (f) I12: D never syncs again, so it never sends; in X (company stop) C waits too, in Y it sends
  const [xc, xd] = x.leads.map((l) => l.cl.id);
  const [yc, yd] = y.leads.map((l) => l.cl.id);
  expect(before.get(D.id)).toBe(2);
  expect((await sentIds(D)).length).toBe(2);
  const sent2 = async (cl: string) =>
    P.scheduledMessage.count({ where: { campaignLeadId: cl, status: "SENT", step: { order: 2 } } });
  expect([await sent2(xc!), await sent2(xd!), await sent2(yc!), await sent2(yd!)]).toEqual([
    0, 0, 1, 0,
  ]);
  expect((await sentIds(C)).length).toBe(before.get(C.id)! + 1);
  // 30 days: the re-warm allowance after a long pause arrives with P5-T06, which extends this suite
}

/** A hard-bounce DSN (5.1.1) for `rfcMessageId`, as Gmail's mailer-daemon sends it. */
function dsn(to: string, lead: string, rfcMessageId: string, at: Date) {
  return Buffer.from(
    [
      "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      `To: ${to}`,
      "Subject: Delivery Status Notification (Failure)",
      `Date: ${at.toUTCString()}`,
      `Message-ID: <dsn-${randomBytes(4).toString("hex")}@mx.test>`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="B1"',
      "",
      "--B1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      `Address not found. Your message wasn't delivered to ${lead}.`,
      "",
      "--B1",
      "Content-Type: message/delivery-status",
      "",
      "Reporting-MTA: dns; mx.test",
      "",
      `Final-Recipient: rfc822; ${lead}`,
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.",
      "",
      "--B1",
      "Content-Type: text/rfc822-headers",
      "",
      `From: ${to}`,
      `To: ${lead}`,
      `Message-ID: ${rfcMessageId}`,
      "",
      "--B1--",
      "",
    ].join("\r\n"),
  );
}
