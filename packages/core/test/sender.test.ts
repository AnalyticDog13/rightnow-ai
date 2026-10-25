import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrisma } from "@rightnow/db/create";
import type {
  AccountProvider,
  CampaignLead,
  EmailAccount,
  PrismaClient,
  ScheduledMessage,
} from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import {
  AmbiguousSendError,
  AuthError,
  PermanentSendError,
  getFakeProvider,
  type MailProvider,
  type OutboundMime,
  type SendResult,
} from "@rightnow/providers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { resumeAccount } from "../src/accounts/service";
import { removeCampaignLead, resumeCampaignLead } from "../src/campaigns/enroll";
import { claimDue, sendableProviders, type ClaimOpts, type Claimed } from "../src/dispatch";
import { whyNotSending } from "../src/explain";
import { ingestMessage, recordOutboundMessage } from "../src/mail/ingest";
import { planDue } from "../src/planner";
import { releaseUsage } from "../src/quota";
import {
  SEND_TIMEOUT_MS,
  STALE_CLAIM_MS,
  dispatchTick,
  recordAccepted,
  sendClaimed,
  type SenderDeps,
} from "../src/sender";
import { unsubscribeKeys, unsubscribeLead, type RenderEnv } from "../src/unsubscribe";
import { markFresh, seedCampaign } from "./campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "sender-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const extra: PrismaClient[] = [];
const P = () => db.prisma;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await Promise.all(extra.splice(0).map((p) => p.$disconnect()));
  await db.drop();
});

const ALL: AccountProvider[] = ["GMAIL", "MICROSOFT", "SMTP"];
const T = new Date("2026-10-20T10:00:00Z"); // Tuesday
const keys = unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") });
const env: RenderEnv = { appUrl: "https://app.example.com", unsubscribeKeys: keys };
const fake = (a: { email: string }) => getFakeProvider(a.email);
const deps = (o: Partial<SenderDeps> = {}): SenderDeps => ({
  providerFor: fake,
  env,
  random: () => 0,
  ...o,
});
const claimOpts = (o: Partial<ClaimOpts> = {}): ClaimOpts => ({
  limit: 1,
  bootId: "boot-1",
  stalenessSec: 300,
  sendableProviders: ALL,
  env,
  ...o,
});
async function claim(clock: { now(): Date }, o: Partial<ClaimOpts> = {}, db2 = P()) {
  const [c] = await claimDue(db2, clock, claimOpts(o));
  if (!c) throw new Error("nothing claimed");
  return c;
}
const row = (id: string) => P().scheduledMessage.findUniqueOrThrow({ where: { id } });
const acct = (id: string) => P().emailAccount.findUniqueOrThrow({ where: { id } });
const usage = async (accountId: string) =>
  (await P().accountDailyUsage.findMany({ where: { accountId }, orderBy: { day: "asc" } })).map(
    (u) => [u.sent, u.reserved],
  );
const sent = async (a: { email: string }) => (await fake(a).sentRaw()).length;
/** A provider that runs `before` once send was called (after the pre-call check), then delegates to the Fake. */
const around = (
  a: { email: string },
  o: { before?: () => Promise<void>; after?: () => Promise<void> },
): MailProvider =>
  Object.assign(Object.create(fake(a)) as MailProvider, {
    async send(m: OutboundMime, x?: { signal?: AbortSignal }): Promise<SendResult> {
      await o.before?.();
      const r = await fake(a).send(m, x);
      await o.after?.();
      return r;
    },
  });
const throwing = (a: { email: string }, e: () => unknown): MailProvider =>
  Object.assign(Object.create(fake(a)) as MailProvider, {
    async send(): Promise<SendResult> {
      throw e();
    },
  });

describe("sendClaimed: accepted", () => {
  test("accepted: SENT, reservation moved to sent on the stored day, counters, sticky sender, advance, headers and footer", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}] });
    const A = s.accounts[0]!;
    await P().emailAccount.update({ where: { id: A.id }, data: { consecutivePermanentErrors: 2 } });
    const c = await claim(clock);
    expect(await usage(A.id)).toEqual([[0, 1]]);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("SENT");

    const r = await row(c.id);
    expect(r).toMatchObject({ status: "SENT", sentAt: T, claimToken: c.claimToken });
    expect(r.providerMessageId).toMatch(/^fake-/);
    expect(await usage(A.id)).toEqual([[1, 0]]);
    expect(await P().campaignDailyUsage.findMany()).toMatchObject([{ sent: 1, reserved: 0 }]);
    expect(await P().workspaceDailyUsage.findMany()).toMatchObject([{ sent: 1, reserved: 0 }]);
    const lead = await P().lead.findUniqueOrThrow({ where: { id: s.leads[0]!.lead.id } });
    expect(lead).toMatchObject({
      emailsSent: 1,
      lastContactedAt: T,
      lastTouchAt: T,
      lastSenderAccountId: A.id,
    });
    const cl = await P().campaignLead.findUniqueOrThrow({ where: { id: s.leads[0]!.cl.id } });
    expect(cl).toMatchObject({ accountId: A.id, currentStepId: s.steps[1]!.id, state: "ACTIVE" });
    expect(cl.threadRef).toBe(r.providerThreadId);
    expect(await acct(A.id)).toMatchObject({
      lastSentAt: T,
      lastCampaignActivityAt: T,
      consecutivePermanentErrors: 0,
    });

    const m = (await fake(A).findSent(c.rfcMessageId))!;
    expect(m.rfcMessageId).toBe(c.rfcMessageId);
    expect(m.headers["list-unsubscribe"]![0]).toMatch(
      new RegExp(
        `^<https://app\\.example\\.com/u/[\\w.-]+>, <mailto:${A.email}\\?subject=unsubscribe>$`,
      ),
    );
    expect(m.headers["list-unsubscribe-post"]).toEqual(["List-Unsubscribe=One-Click"]);
    expect(m.text).toContain("1 Main St");
    expect(m.html).toContain("1 Main St");
  });

  test("accepted send writes an ACCEPTED event and an outbound Message; recording again changes nothing", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const c = await claim(clock);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("SENT");
    const events = await P().event.findMany({ where: { scheduledMessageId: c.id } });
    expect(events).toMatchObject([
      {
        type: "ACCEPTED",
        dedupeKey: `acc:${c.id}`,
        leadId: s.leads[0]!.lead.id,
        campaignId: s.campaign.id,
        stepId: s.steps[0]!.id,
        accountId: s.accounts[0]!.id,
      },
    ]);
    const out = await P().message.findMany({ where: { scheduledMessageId: c.id } });
    expect(out).toMatchObject([
      { direction: "OUT", kind: "OUTBOUND", outsideApp: false, rfcMessageId: c.rfcMessageId },
    ]);
    await recordOutboundMessage(P(), c.id);
    expect(await P().message.count()).toBe(1);
    expect(await P().thread.count()).toBe(1);
    expect(await P().event.count({ where: { scheduledMessageId: c.id } })).toBe(1);
  });

  test("a FAILED settle writes a SEND_FAILED event", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    fake(s.accounts[0]!).failNext("permanent_rejected");
    const c = await claim(clock);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("FAILED");
    expect(await P().event.findMany({ where: { scheduledMessageId: c.id } })).toMatchObject([
      { type: "SEND_FAILED", dedupeKey: `fail:${c.id}`, meta: { error: "permanent_rejected" } },
    ]);
    expect(await P().message.count()).toBe(0);
  });

  test("cc and bcc: Cc header, never a Bcc header; units = 1 + cc + bcc", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), {
      at: T,
      rows: 1,
      accounts: [{}],
      campaign: { cc: ["cc@x.test"], bcc: ["hidden@x.test"] },
    });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("SENT");
    const m = (await fake(A).findSent(c.rfcMessageId))!;
    expect(m.cc).toEqual([{ email: "cc@x.test" }]);
    expect(m.headers.bcc).toBeUndefined();
    expect((await fake(A).sentRaw())[0]!.toString()).not.toContain("hidden@x.test");
    expect(await usage(A.id)).toEqual([[3, 0]]);
  });

  test("an http app URL: mailto only, no List-Unsubscribe-Post", async () => {
    const clock = fixedClock(T);
    const local = { appUrl: "http://localhost:3000", unsubscribeKeys: keys };
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock, { env: local });
    expect(await sendClaimed(P(), clock, deps({ env: local }), c)).toBe("SENT");
    const m = (await fake(A).findSent(c.rfcMessageId))!;
    expect(m.headers["list-unsubscribe"]).toEqual([`<mailto:${A.email}?subject=unsubscribe>`]);
    expect(m.headers["list-unsubscribe-post"]).toBeUndefined();
  });

  test("follow-up: Re: subject, In-Reply-To and References, same From, threadId passed", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}, {}] });
    await P().stepVariant.update({ where: { id: s.steps[1]!.variant.id }, data: { subject: "" } });
    const c1 = await claim(clock);
    expect(await sendClaimed(P(), clock, deps(), c1)).toBe("SENT");
    const clId = s.leads[0]!.cl.id;
    // a Gmail-style thread id must reach the provider as is
    await P().campaignLead.update({ where: { id: clId }, data: { threadRef: "t-custom" } });
    const due = (await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).nextDueAt!;
    clock.advance(due.getTime() - T.getTime());
    await markFresh(
      P(),
      s.accounts.map((a) => a.id),
      clock.now(),
    );
    await planDue(P(), clock, { stalenessSec: 300, sendableProviders: ALL, env });
    const c2 = await claim(clock);
    expect(c2.stepId).toBe(s.steps[1]!.id);
    expect(await sendClaimed(P(), clock, deps(), c2)).toBe("SENT");
    const from = s.accounts.find((a) => a.id === c1.accountId)!;
    expect(c2.accountId).toBe(from.id); // sticky
    const m = (await fake(from).findSent(c2.rfcMessageId))!;
    expect(m.subject).toBe("Re: Hi");
    expect(m.inReplyTo).toBe(c1.rfcMessageId);
    expect(m.references).toEqual([c1.rfcMessageId]);
    expect(m.from.email).toBe(from.email);
    expect(m.providerThreadId).toBe("t-custom");
  });
});

describe("sendClaimed: errors", () => {
  test("429 pushes account", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    fake(A).failNext("rate_limit", 120);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("RETRY");
    expect(await row(c.id)).toMatchObject({
      status: "SCHEDULED",
      attempts: 1,
      dueAt: new Date(T.getTime() + 120_000),
    });
    expect((await acct(A.id)).nextSendAt).toEqual(new Date(T.getTime() + 120_000));
    expect(await usage(A.id)).toEqual([[0, 0]]);
  });

  test("transient: backoff 60 s · 2^(attempts−1) + jitter (M11); the 5th fails, the lead PAUSED SEND_FAILED (I3)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const waits: number[] = [];
    for (let i = 1; i <= 5; i++) {
      await markFresh(P(), [A.id], clock.now());
      const c = await claim(clock);
      fake(A).failNext("connect_refused");
      const out = await sendClaimed(P(), clock, deps(), c);
      const r = await row(c.id);
      if (i < 5) {
        expect(out).toBe("RETRY");
        expect(r).toMatchObject({ status: "SCHEDULED", attempts: i });
        waits.push((r.dueAt.getTime() - clock.now().getTime()) / 1000);
        clock.advance(r.dueAt.getTime() - clock.now().getTime());
      } else {
        expect(out).toBe("FAILED");
        expect(r).toMatchObject({ status: "FAILED", attempts: 5, error: "max_attempts" });
      }
    }
    expect(waits).toEqual([60, 120, 240, 480]);
    expect((await usage(A.id)).every(([, reserved]) => reserved === 0)).toBe(true);
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: s.leads[0]!.cl.id } }),
    ).toMatchObject({ state: "PAUSED", stopReason: "SEND_FAILED" });
    expect(await sent(A)).toBe(0);
  });

  test("transient jitter: random 0.5 adds 15 s", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const c = await claim(clock);
    fake(s.accounts[0]!).failNext("connect_refused");
    expect(await sendClaimed(P(), clock, deps({ random: () => 0.5 }), c)).toBe("RETRY");
    expect((await row(c.id)).dueAt).toEqual(new Date(T.getTime() + 75_000));
  });

  test("ambiguous timeout and API 5xx → UNCERTAIN", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 4, accounts: [{}] });
    const A = s.accounts[0]!;
    for (const k of ["timeout_after_write", "api_5xx"] as const) {
      const c = await claim(clock);
      fake(A).failNext(k);
      expect(await sendClaimed(P(), clock, deps(), c)).toBe("UNCERTAIN");
      expect(await row(c.id)).toMatchObject({ status: "UNCERTAIN", uncertainAt: T });
    }
    const hint = await claim(clock);
    const e = new AmbiguousSendError("draft sent?");
    e.providerMessageId = "d-1";
    expect(
      await sendClaimed(P(), clock, deps({ providerFor: (a) => throwing(a, () => e) }), hint),
    ).toBe("UNCERTAIN");
    expect(await row(hint.id)).toMatchObject({ status: "UNCERTAIN", providerMessageId: "d-1" });
    // anything that is not a classified provider error is treated as "may have been sent"
    const odd = await claim(clock);
    expect(
      await sendClaimed(
        P(),
        clock,
        deps({ providerFor: (a) => throwing(a, () => new Error("boom")) }),
        odd,
      ),
    ).toBe("UNCERTAIN");
    expect(await usage(A.id)).toEqual([[0, 4]]); // every reservation is kept
    expect(await sent(A)).toBe(2); // the Fake persisted the two ambiguous sends
  });

  test("I-8: permanent_rejected → FAILED, lead STOPPED BOUNCED, HARD_BOUNCE suppression, account health untouched", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    fake(A).failNext("permanent_rejected");
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("FAILED");
    expect(await row(c.id)).toMatchObject({ status: "FAILED", error: "permanent_rejected" });
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: s.leads[0]!.cl.id } }),
    ).toMatchObject({ state: "STOPPED", stopReason: "BOUNCED" });
    expect(await P().suppression.findMany()).toMatchObject([
      { kind: "EMAIL", value: s.leads[0]!.lead.email, reason: "HARD_BOUNCE", source: "send" },
    ]);
    expect(await acct(A.id)).toMatchObject({
      errorCount24h: 0,
      lifecycle: "ACTIVE",
      consecutivePermanentErrors: 0,
    });
    expect(await usage(A.id)).toEqual([[0, 0]]);
  });

  test("account-scope error pauses the account, not the lead", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    // a mailbox that refuses our From: the Fake answers from_mismatch, which every provider scopes to the account
    const out = await sendClaimed(
      P(),
      clock,
      deps({ providerFor: () => getFakeProvider("someone-else@send.test") }),
      c,
    );
    expect(out).toBe("RELEASED");
    expect(await row(c.id)).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(await usage(A.id)).toEqual([[0, 0]]);
    const a = await acct(A.id);
    expect(a.lifecycle).toBe("PAUSED");
    expect(a.lastError).toMatchObject({ kind: "SENDING", code: "from_mismatch" });
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: s.leads[0]!.cl.id } }),
    ).toMatchObject({ state: "ACTIVE", stopReason: null });
    expect(await P().suppression.count()).toBe(0);
    expect(await claimDue(P(), clock, claimOpts())).toEqual([]);
    await P().emailAccount.update({ where: { id: A.id }, data: { consecutivePermanentErrors: 2 } });
    await resumeAccount(P(), s.ws, A.id, { clock });
    expect((await acct(A.id)).consecutivePermanentErrors).toBe(0);
    expect(await claimDue(P(), clock, claimOpts())).toHaveLength(1);
  });

  test("three unknown permanent errors pause the account", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 3, accounts: [{}] });
    const A = s.accounts[0]!;
    for (let i = 1; i <= 3; i++) {
      const c = await claim(clock);
      fake(A).failNext("smtp_5xx");
      expect(await sendClaimed(P(), clock, deps(), c)).toBe("FAILED");
      expect(await row(c.id)).toMatchObject({ status: "FAILED" });
      expect(
        await P().campaignLead.findUniqueOrThrow({ where: { id: c.campaignLeadId } }),
      ).toMatchObject({ state: "PAUSED", stopReason: "SEND_FAILED" });
      expect(await acct(A.id)).toMatchObject({
        consecutivePermanentErrors: i,
        lifecycle: i < 3 ? "ACTIVE" : "PAUSED",
      });
    }
    expect((await acct(A.id)).lastError).toMatchObject({ kind: "SENDING" });
    expect(await P().suppression.count()).toBe(0);
    expect(await usage(A.id)).toEqual([[0, 0]]);
  });

  test("a SENT between the 2nd and 3rd unknown error resets the counter, so the account stays ACTIVE", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 4, accounts: [{}] });
    const A = s.accounts[0]!;
    for (const k of ["smtp_5xx", "smtp_5xx", null, "smtp_5xx"] as const) {
      const c = await claim(clock);
      if (k) fake(A).failNext(k);
      await sendClaimed(P(), clock, deps(), c);
    }
    expect(await acct(A.id)).toMatchObject({ lifecycle: "ACTIVE", consecutivePermanentErrors: 1 });
  });

  test("M365 5.4.1 rejections are FAILED but never count toward the pause (Revision 3)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 3, accounts: [{}] });
    const A = s.accounts[0]!;
    const e = () =>
      new PermanentSendError("smtp_550", undefined, { scope: "unknown", countsTowardPause: false });
    for (let i = 0; i < 3; i++) {
      const c = await claim(clock);
      expect(await sendClaimed(P(), clock, deps({ providerFor: (a) => throwing(a, e) }), c)).toBe(
        "FAILED",
      );
    }
    expect(await acct(A.id)).toMatchObject({ lifecycle: "ACTIVE", consecutivePermanentErrors: 0 });
  });

  test("gate N-1: lead_rejected_partial is FAILED with its usage committed (the Cc copy left), never retried", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 2, accounts: [{}] });
    const A = s.accounts[0]!;
    const partial = (scope: "unknown" | "recipient") => () =>
      new PermanentSendError("lead_rejected_partial", undefined, {
        scope,
        countsTowardPause: scope === "recipient",
      });
    const c = await claim(clock);
    expect(
      await sendClaimed(
        P(),
        clock,
        deps({ providerFor: (a) => throwing(a, partial("unknown")) }),
        c,
      ),
    ).toBe("FAILED");
    expect(await row(c.id)).toMatchObject({ status: "FAILED", error: "lead_rejected_partial" });
    expect(await usage(A.id)).toEqual([[1, 0]]);
    expect(await P().campaignDailyUsage.findMany()).toMatchObject([{ sent: 1, reserved: 0 }]);
    expect(await P().workspaceDailyUsage.findMany()).toMatchObject([{ sent: 1, reserved: 0 }]);
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: c.campaignLeadId } }),
    ).toMatchObject({ state: "PAUSED" });
    expect(await acct(A.id)).toMatchObject({ lifecycle: "ACTIVE", consecutivePermanentErrors: 0 });

    const c2 = await claim(clock);
    expect(
      await sendClaimed(
        P(),
        clock,
        deps({ providerFor: (a) => throwing(a, partial("recipient")) }),
        c2,
      ),
    ).toBe("FAILED");
    expect(await usage(A.id)).toEqual([[2, 0]]);
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: c2.campaignLeadId } }),
    ).toMatchObject({ state: "STOPPED", stopReason: "BOUNCED" });
    expect(await P().suppression.count()).toBe(1);
    expect(await P().scheduledMessage.count({ where: { status: "SCHEDULED" } })).toBe(0);
  });

  test("P3-T11a: a Gmail recipient rejection on a row with cc is unknown scope (nobody suppressed, no strike)", async () => {
    const clock = fixedClock(T);
    const gmail = { provider: "GMAIL" as const, capTier: "GMAIL_WORKSPACE" as const };
    const s = await seedCampaign(P(), {
      at: T,
      rows: 1,
      accounts: [gmail],
      campaign: { cc: ["cc@x.test"] },
    });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    fake(A).failNext("permanent_rejected");
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("FAILED");
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: c.campaignLeadId } }),
    ).toMatchObject({ state: "PAUSED", stopReason: "SEND_FAILED" });
    expect(await P().suppression.count()).toBe(0);
    expect(await acct(A.id)).toMatchObject({ lifecycle: "ACTIVE", consecutivePermanentErrors: 0 });
    expect(await P().event.findMany({ where: { scheduledMessageId: c.id } })).toMatchObject([
      { type: "SEND_FAILED", meta: { error: "permanent_rejected", scope: "unknown" } },
    ]);

    // without cc the provider's recipient scope stands: BOUNCED and suppressed, as before
    const s2 = await seedCampaign(P(), { at: T, rows: 1, accounts: [gmail] });
    const c2 = await claim(clock);
    fake(s2.accounts[0]!).failNext("permanent_rejected");
    expect(await sendClaimed(P(), clock, deps(), c2)).toBe("FAILED");
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: c2.campaignLeadId } }),
    ).toMatchObject({ state: "STOPPED", stopReason: "BOUNCED" });
    expect(await P().suppression.count()).toBe(1);
    expect(await P().event.findMany({ where: { scheduledMessageId: c2.id } })).toMatchObject([
      { type: "SEND_FAILED", meta: { error: "permanent_rejected", scope: "recipient" } },
    ]);
  });

  test("AuthError → account NEEDS_ATTENTION, row SCHEDULED, reserved 0; a user pause wins", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 2, accounts: [{}, {}] });
    const [A, B] = s.accounts as [EmailAccount, EmailAccount];
    const c = await claim(clock);
    const first = c.accountId === A.id ? A : B;
    const other = first === A ? B : A;
    fake(first).failNext("auth_revoked");
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("AUTH");
    expect(await row(c.id)).toMatchObject({ status: "SCHEDULED", attempts: 0 });
    expect(await acct(first.id)).toMatchObject({ lifecycle: "NEEDS_ATTENTION", status: "ERROR" });
    expect(await usage(first.id)).toEqual([[0, 0]]);

    const c2 = await claim(clock);
    expect(c2.accountId).toBe(other.id);
    // the user pauses the account while the send is in flight; the provider then reports an auth failure
    const pausedMidSend = (a: { email: string }) =>
      around(a, {
        before: async () => {
          await P().emailAccount.update({ where: { id: other.id }, data: { lifecycle: "PAUSED" } });
          throw new AuthError("invalid_grant");
        },
      });
    const out = await sendClaimed(P(), clock, deps({ providerFor: pausedMidSend }), c2);
    expect(out).toBe("AUTH");
    expect(await acct(other.id)).toMatchObject({ lifecycle: "PAUSED", status: "ERROR" });
    expect(await usage(other.id)).toEqual([[0, 0]]);
  });
});

describe("sendClaimed: pre-call checks", () => {
  test("stale claim (>2 min) not sent", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    clock.advance(121_000);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("STALE");
    expect(await sent(A)).toBe(0);
    expect(await row(c.id)).toMatchObject({ status: "SCHEDULED" });
    expect(await usage(A.id)).toEqual([[0, 0]]);
  });

  test("gate M-2: a claim that went stale during the pre-call check (sleep) is not sent", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const c = await claim(fixedClock(T));
    let calls = 0;
    // the machine sleeps right after the pre-call check read the time
    const clock = { now: () => new Date(T.getTime() + (calls++ === 0 ? 0 : 121_000)) };
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("STALE");
    expect(await sent(s.accounts[0]!)).toBe(0);
    expect(await row(c.id)).toMatchObject({ status: "SCHEDULED" });
  });

  test("a claim exactly 2 min old is still sent", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const c = await claim(clock);
    clock.advance(STALE_CLAIM_MS);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("SENT");
    expect(await sent(s.accounts[0]!)).toBe(1);
  });

  test("Review Focus 2: paused campaign, unsubscribed lead, account removed from the campaign", async () => {
    const clock = fixedClock(T);
    const cases: [
      string,
      (s: Awaited<ReturnType<typeof seedCampaign>>) => Promise<unknown>,
      string,
    ][] = [
      [
        "campaign paused",
        (s) => P().campaign.update({ where: { id: s.campaign.id }, data: { status: "PAUSED" } }),
        "RELEASED",
      ],
      [
        "lead unsubscribed",
        (s) =>
          unsubscribeLead(
            P(),
            clock,
            { w: s.ws, l: s.leads[0]!.lead.id, c: s.campaign.id },
            "page",
          ),
        "CANCELLED",
      ],
      [
        "account removed",
        (s) => P().campaignAccount.deleteMany({ where: { campaignId: s.campaign.id } }),
        "RELEASED",
      ],
    ];
    for (const [, between, want] of cases) {
      const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
      const A = s.accounts[0]!;
      const c = await claim(clock);
      await between(s);
      expect(await sendClaimed(P(), clock, deps(), c)).toBe(want);
      expect(await sent(A)).toBe(0);
      expect(await usage(A.id)).toEqual([[0, 0]]);
      expect((await row(c.id)).status).toBe(want === "RELEASED" ? "SCHEDULED" : "CANCELLED");
    }
  });

  test("stopped lead between claim and send (I1)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    await removeCampaignLead(P(), clock, s.ws, null, s.leads[0]!.cl.id);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("CANCELLED");
    expect((await row(c.id)).status).toBe("CANCELLED");
    expect(await usage(A.id)).toEqual([[0, 0]]);
    expect(await sent(A)).toBe(0);
    expect(
      (await planDue(P(), clock, { stalenessSec: 300, sendableProviders: ALL, env })).completed,
    ).toBe(1);
    expect((await P().campaign.findUniqueOrThrow({ where: { id: s.campaign.id } })).status).toBe(
      "COMPLETED",
    );
  });

  test("window closed between claim and send (M1)", async () => {
    const at = new Date("2026-10-20T16:59:30Z");
    const clock = fixedClock(at);
    const s = await seedCampaign(P(), {
      at,
      rows: 1,
      accounts: [{}],
      schedules: [{ timezone: "UTC", days: 127, from: "09:00", to: "17:00" }],
    });
    const c = await claim(clock);
    clock.advance(60_000);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("RELEASED");
    expect(await row(c.id)).toMatchObject({
      status: "SCHEDULED",
      dueAt: new Date("2026-10-21T09:00:00Z"),
    });
    expect(await sent(s.accounts[0]!)).toBe(0);
    expect(await usage(s.accounts[0]!.id)).toEqual([[0, 0]]);
  });

  test("subject with CR/LF never reaches the provider (I11)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    await P()
      .$executeRaw`UPDATE "ScheduledMessage" SET "renderedSubject" = ${"A\r\nBcc: x@y"} WHERE id = ${c.id}`;
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("FAILED");
    expect(await row(c.id)).toMatchObject({ status: "FAILED", error: "mime_invalid" });
    expect(await sent(A)).toBe(0);
    expect(await usage(A.id)).toEqual([[0, 0]]);
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: c.campaignLeadId } }),
    ).toMatchObject({ state: "PAUSED", stopReason: "SEND_FAILED" });
  });

  test("lease: the provider call is bounded by a 60 s timeout, far inside the 10 min lease", async () => {
    expect(SEND_TIMEOUT_MS).toBe(60_000);
    expect(STALE_CLAIM_MS + SEND_TIMEOUT_MS).toBeLessThan(600_000);
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    let signal: AbortSignal | undefined;
    const c = await claim(clock);
    const spy = (a: { email: string }) =>
      Object.assign(Object.create(fake(a)) as MailProvider, {
        send: (m: OutboundMime, o?: { signal?: AbortSignal }) => {
          signal = o?.signal;
          return fake(a).send(m, o);
        },
      });
    expect(await sendClaimed(P(), clock, deps({ providerFor: spy }), c)).toBe("SENT");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    expect(await sent(s.accounts[0]!)).toBe(1);
  });
});

describe("claim re-renders stale text under the row lock", () => {
  test("a row whose stored text is stale is re-rendered by the claim before it is sent", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    await P().stepVariant.update({
      where: { id: s.steps[0]!.variant.id },
      data: { subject: "Hello {{email}}", body: "New body" },
    });
    const c = await claim(clock);
    const r = await row(c.id);
    expect(r.renderedSubject).toBe(`Hello ${s.leads[0]!.lead.email}`);
    expect(r.renderedText).toContain("New body");
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("SENT");
    expect((await fake(s.accounts[0]!).findSent(c.rfcMessageId))!.subject).toBe(
      `Hello ${s.leads[0]!.lead.email}`,
    );
  });

  test("a variant edit that commits while the claim holds the row is still picked up (FOR SHARE)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const v = s.steps[0]!.variant.id;
    const editor = createPrisma(db.url, 2);
    extra.push(editor);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let edited!: () => void;
    const held = new Promise<void>((r) => (edited = r));
    const edit = editor.$transaction(
      async (tx) => {
        await tx.stepVariant.update({ where: { id: v }, data: { subject: "Edited" } });
        edited();
        await gate;
      },
      { timeout: 60_000 },
    );
    await held;
    const claiming = claimDue(P(), clock, claimOpts());
    for (let i = 0; ; i++) {
      const [w] = await editor.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (w!.n >= 1) break;
      if (i > 200) throw new Error("the claim never waited for the variant edit");
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await edit;
    const [c] = await claiming;
    expect((await row(c!.id)).renderedSubject).toBe("Edited");
  });
});

describe("late accept", () => {
  /** Claims a row and sends it; `between` runs after the provider accepted, before the result is recorded. */
  async function lateAccept(
    between: (c: Claimed, s: Awaited<ReturnType<typeof seedCampaign>>) => Promise<void>,
  ) {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 2, steps: 2, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    await claim(clock); // another in-flight claim keeps 1 unit reserved: a wrong commit/credit would eat it
    const out = await sendClaimed(
      P(),
      clock,
      deps({ providerFor: (a) => around(a, { after: () => between(c, s) }) }),
      c,
    );
    return { clock, s, A, c, out };
  }
  const holdAndRelease = (c: Claimed) =>
    P().$transaction(async (tx) => {
      await tx.scheduledMessage.update({ where: { id: c.id }, data: { status: "HELD" } });
      await releaseUsage(tx, c);
    });

  test("late accept on HELD row credits sent once", async () => {
    const { clock, s, A, c, out } = await lateAccept((c) => holdAndRelease(c));
    expect(out).toBe("SENT");
    const r = await row(c.id);
    expect(r).toMatchObject({ status: "SENT", claimToken: c.claimToken, sentAt: T });
    expect(await usage(A.id)).toEqual([[1, 1]]);
    expect(
      (await P().campaignLead.findUniqueOrThrow({ where: { id: c.campaignLeadId } })).currentStepId,
    ).toBe(s.steps[1]!.id);
    // repeating the handler changes nothing
    await recordAccepted(P(), clock, c, {
      rfcMessageId: c.rfcMessageId,
      providerMessageId: r.providerMessageId!,
    });
    expect(await usage(A.id)).toEqual([[1, 1]]);
    const cl = await P().campaignLead.findUniqueOrThrow({ where: { id: c.campaignLeadId } });
    expect(await P().lead.findUniqueOrThrow({ where: { id: cl.leadId } })).toMatchObject({
      emailsSent: 1,
    });
  });

  test("UNCERTAIN → SENT, the kept reservation moves to sent", async () => {
    const { A, c, out } = await lateAccept((c) =>
      P()
        .scheduledMessage.update({
          where: { id: c.id },
          data: { status: "UNCERTAIN", uncertainAt: T },
        })
        .then(() => {}),
    );
    expect(out).toBe("SENT");
    expect((await row(c.id)).status).toBe("SENT");
    expect(await usage(A.id)).toEqual([[1, 1]]);
  });

  test("SCHEDULED (released HELD row) → SENT, the pending re-send is gone", async () => {
    const { clock, A, c, out } = await lateAccept(async (c) => {
      await holdAndRelease(c);
      await P().scheduledMessage.update({
        where: { id: c.id },
        data: { status: "SCHEDULED", dueAt: T },
      });
    });
    expect(out).toBe("SENT");
    expect((await row(c.id)).status).toBe("SENT");
    expect(await usage(A.id)).toEqual([[1, 1]]);
    expect(await claimDue(P(), clock, claimOpts())).toEqual([]);
    expect(await sent(A)).toBe(1);
  });

  test("CANCELLED → SENT, credited", async () => {
    const { A, c, out } = await lateAccept(async (c) => {
      await holdAndRelease(c);
      await P().scheduledMessage.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    });
    expect(out).toBe("SENT");
    expect((await row(c.id)).status).toBe("SENT");
    expect(await usage(A.id)).toEqual([[1, 1]]);
  });

  test("re-claimed under T2 → SENT on T2's reservation; T2's sender is LOST and never sends", async () => {
    let c2!: Claimed;
    const { clock, A, c, out } = await lateAccept(async (c) => {
      await holdAndRelease(c);
      await P().scheduledMessage.update({
        where: { id: c.id },
        data: { status: "SCHEDULED", dueAt: T },
      });
      c2 = await claim(fixedClock(T));
    });
    expect(out).toBe("SENT");
    expect(c2.claimToken).not.toBe(c.claimToken);
    expect(await row(c.id)).toMatchObject({ status: "SENT", claimToken: c.claimToken });
    expect(await usage(A.id)).toEqual([[1, 1]]);
    expect(await sendClaimed(P(), clock, deps(), c2)).toBe("LOST");
    expect(await sent(A)).toBe(1);
    expect(await usage(A.id)).toEqual([[1, 1]]);
  });

  test("double send after release credits both (I8)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 2, steps: 2, accounts: [{}] });
    const A = s.accounts[0]!;
    const gate = () => {
      let open!: () => void;
      let entered!: () => void;
      const g = new Promise<void>((r) => (open = r));
      const e = new Promise<void>((r) => (entered = r));
      return { open, entered: e, wait: async () => (entered(), g) };
    };
    const g1 = gate();
    const g2 = gate();
    const c1 = await claim(clock);
    await claim(clock); // keeps 1 unit reserved throughout
    const p1 = sendClaimed(
      P(),
      clock,
      deps({ providerFor: (a) => around(a, { before: g1.wait }) }),
      c1,
    );
    await g1.entered; // T1 passed its pre-call check and is inside the provider call
    await P().$transaction(async (tx) => {
      await tx.scheduledMessage.update({ where: { id: c1.id }, data: { status: "HELD" } });
      await releaseUsage(tx, c1);
    });
    await P().scheduledMessage.update({
      where: { id: c1.id },
      data: { status: "SCHEDULED", dueAt: T },
    }); // releaseHeld
    const c2 = await claim(clock);
    const p2 = sendClaimed(
      P(),
      clock,
      deps({ providerFor: (a) => around(a, { before: g2.wait }) }),
      c2,
    );
    await g2.entered;
    g1.open();
    expect(await p1).toBe("SENT");
    g2.open();
    expect(await p2).toBe("SENT");
    expect(await sent(A)).toBe(2);
    expect(await usage(A.id)).toEqual([[2, 1]]);
    expect(await row(c1.id)).toMatchObject({ status: "SENT", claimToken: c1.claimToken });
  });

  test("a claim whose row was re-claimed meanwhile never calls the provider", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c1 = await claim(clock);
    await P().$transaction(async (tx) => {
      await tx.scheduledMessage.update({ where: { id: c1.id }, data: { status: "SCHEDULED" } });
      await releaseUsage(tx, c1);
    });
    const c2 = await claim(clock);
    expect(await sendClaimed(P(), clock, deps(), c1)).toBe("LOST");
    expect(await sent(A)).toBe(0);
    expect(await usage(A.id)).toEqual([[0, 1]]);
    expect(await sendClaimed(P(), clock, deps(), c2)).toBe("SENT");
    expect(await sent(A)).toBe(1);
  });

  test("a stale claim never touches a row re-claimed under another token", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c1 = await claim(clock);
    clock.advance(121_000);
    await markFresh(P(), [A.id], clock.now());
    await P().$transaction(async (tx) => {
      await tx.scheduledMessage.update({ where: { id: c1.id }, data: { status: "SCHEDULED" } });
      await releaseUsage(tx, c1);
    });
    const c2 = await claim(clock);
    expect(await sendClaimed(P(), clock, deps(), c1)).toBe("LOST");
    expect(await row(c1.id)).toMatchObject({ status: "SENDING", claimToken: c2.claimToken });
    expect(await usage(A.id)).toEqual([[0, 1]]);
    expect(await sendClaimed(P(), clock, deps(), c2)).toBe("SENT");
    expect(await sent(A)).toBe(1);
    expect(await usage(A.id)).toEqual([[1, 0]]);
  });
});

describe("dispatchTick", () => {
  test("3 accounts, 6 due rows, concurrency 2 → 6 SENT, no account gap violated", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), {
      at: T,
      rows: 6,
      accounts: [{ minGapSec: 60 }, { minGapSec: 60 }, { minGapSec: 60 }],
    });
    const tick = () =>
      dispatchTick(P(), clock, {
        ...deps(),
        bootId: "boot-1",
        stalenessSec: 300,
        sendableProviders: ALL,
        concurrency: 2,
      });
    expect((await tick()).SENT).toBe(3);
    for (const a of s.accounts)
      expect((await acct(a.id)).nextSendAt).toEqual(new Date(T.getTime() + 60_000));
    clock.advance(60_000);
    expect((await tick()).SENT).toBe(3);
    const rows = await P().scheduledMessage.findMany({ orderBy: { sentAt: "asc" } });
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
    for (const a of s.accounts) {
      const times = rows.filter((r) => r.accountId === a.id).map((r) => r.sentAt!.getTime());
      expect(times).toHaveLength(2);
      expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(60_000);
      expect(await sent(a)).toBe(2);
    }
  });

  test("gate I-1: a stop signal ends the tick after the in-flight batch; nothing new is claimed or left SENDING", async () => {
    const clock = fixedClock(T);
    await seedCampaign(P(), { at: T, rows: 3, accounts: [{}, {}, {}] });
    const stop = new AbortController();
    const tick = await dispatchTick(P(), clock, {
      ...deps({
        // SIGTERM arrives while the first send is in flight
        providerFor: (a) => around(a, { before: async () => stop.abort() }),
      }),
      bootId: "boot-1",
      stalenessSec: 300,
      sendableProviders: ALL,
      concurrency: 1,
      signal: stop.signal,
    });
    expect(tick.SENT).toBe(1);
    const rows = await P().scheduledMessage.findMany();
    expect(rows.map((r) => r.status).sort()).toEqual(["SCHEDULED", "SCHEDULED", "SENT"]);
    // already stopped: claims nothing at all
    const again = await dispatchTick(P(), clock, {
      ...deps(),
      bootId: "boot-1",
      stalenessSec: 300,
      sendableProviders: ALL,
      signal: stop.signal,
    });
    expect(again.SENT).toBe(0);
    expect(await P().scheduledMessage.count({ where: { status: "SENDING" } })).toBe(0);
  });

  test("D17: nothing is sent from an unverified real provider; a verification row enables it", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const tick = async () =>
      dispatchTick(P(), clock, {
        ...deps(),
        bootId: "boot-1",
        stalenessSec: 300,
        sendableProviders: await sendableProviders(P(), {}),
      });
    expect((await tick()).SENT).toBe(0);
    expect(await sent(A)).toBe(0);
    await P().providerVerification.create({
      data: { provider: "SMTP", passedAt: T, accountId: A.id, report: {} },
    });
    expect((await tick()).SENT).toBe(1);
  });
});

describe("review round 1", () => {
  test("a send that completes after the lead was stopped on its last step never revives it into a subsequence", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const sub = await P().subsequence.create({
      data: {
        campaignId: s.campaign.id,
        name: "no reply",
        trigger: { kind: "ACTIVITY", activity: "completed_no_reply" },
        active: true,
        activatedAt: new Date(T.getTime() - 60_000),
      },
    });
    const st = await P().sequenceStep.create({
      data: { campaignId: s.campaign.id, subsequenceId: sub.id, order: 1, delayValue: 0 },
    });
    await P().stepVariant.create({ data: { stepId: st.id, label: "A", subject: "S", body: "B" } });
    const c = await claim(clock);
    const out = await sendClaimed(
      P(),
      clock,
      deps({
        providerFor: (a) =>
          around(a, {
            before: async () =>
              void (await removeCampaignLead(P(), clock, s.ws, null, c.campaignLeadId)),
          }),
      }),
      c,
    );
    expect(out).toBe("SENT");
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: c.campaignLeadId } }),
    ).toMatchObject({
      state: "STOPPED",
      stopReason: "MANUAL",
      subsequenceId: null,
    });
    await planDue(P(), clock, { stalenessSec: 300, sendableProviders: ALL, env });
    expect(await P().scheduledMessage.count()).toBe(1);
  });

  test("a row whose variant was deleted while it was claimed is cancelled at the next claim, not a claim error", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await claim(clock);
    fake(A).failNext("connect_refused");
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("RETRY");
    await P().stepVariant.create({
      data: { stepId: s.steps[0]!.id, label: "B", subject: "Hi", body: "Other" },
    });
    await P().stepVariant.delete({ where: { id: s.steps[0]!.variant.id } }); // FK SetNull on the row
    clock.advance(61_000);
    await markFresh(P(), [A.id], clock.now());
    expect(await claimDue(P(), clock, claimOpts())).toEqual([]);
    expect(await row(c.id)).toMatchObject({ status: "CANCELLED", variantId: null, claimErrors: 0 });
  });

  test("one throwing send does not block the rest of the dispatch round (I5)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 3, accounts: [{}, {}, {}] });
    const [bad] = s.accounts;
    const tick = await dispatchTick(P(), clock, {
      ...deps({
        providerFor: (a) =>
          a.id === bad!.id
            ? Object.assign(Object.create(fake(a)) as MailProvider, {
                // an accepted send whose result cannot be recorded (Prisma validation throws)
                send: async () => ({
                  rfcMessageId: "x",
                  providerMessageId: 123 as unknown as string,
                }),
              })
            : fake(a),
      }),
      bootId: "boot-1",
      stalenessSec: 300,
      sendableProviders: ALL,
      concurrency: 3,
    });
    expect(tick.SENT).toBe(2);
    const rows = await P().scheduledMessage.findMany();
    expect(rows.find((r) => r.accountId === bad!.id)!.status).toBe("SENDING"); // left for recovery
    expect(rows.filter((r) => r.status === "SENT")).toHaveLength(2);
  });
});

describe("deleted sticky account (P3-T10b re-review)", () => {
  test("a lead whose sticky account was deleted is paused ACCOUNT_UNASSIGNED, its open row cancelled, and not re-selected", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 3, accounts: [{}, {}] });
    const c = await claim(clock);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("SENT");
    const clId = c.campaignLeadId;
    const due = (await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).nextDueAt!;
    clock.advance(due.getTime() - T.getTime());
    await markFresh(
      P(),
      s.accounts.map((a) => a.id),
      clock.now(),
    );
    const plan = () => planDue(P(), clock, { stalenessSec: 300, sendableProviders: ALL, env });
    await plan();
    const step2 = await P().scheduledMessage.findFirstOrThrow({
      where: { stepId: s.steps[1]!.id },
    });
    expect(step2).toMatchObject({ status: "SCHEDULED", accountId: c.accountId });
    await P().emailAccount.update({
      where: { id: c.accountId },
      data: { deletedAt: clock.now(), lifecycle: "PAUSED", status: "DISCONNECTED" },
    });
    await plan();
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).toMatchObject({
      state: "PAUSED",
      stopReason: "ACCOUNT_UNASSIGNED",
      accountId: c.accountId,
    });
    expect((await row(step2.id)).status).toBe("CANCELLED");
    const before = await P().scheduledMessage.findMany({ orderBy: { id: "asc" } });
    await plan();
    expect(await P().scheduledMessage.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    // never re-routed to the other account
    expect(await P().scheduledMessage.count({ where: { accountId: { not: c.accountId } } })).toBe(
      0,
    );
  });

  test("gate I-3: a sticky account removed from the campaign pauses the lead visibly; re-assign + resume continues", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 3, accounts: [{}, {}] });
    const c = await claim(clock);
    expect(await sendClaimed(P(), clock, deps(), c)).toBe("SENT");
    const clId = c.campaignLeadId;
    const due = (await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).nextDueAt!;
    clock.advance(due.getTime() - T.getTime());
    await markFresh(
      P(),
      s.accounts.map((a) => a.id),
      clock.now(),
    );
    const plan = () => planDue(P(), clock, { stalenessSec: 300, sendableProviders: ALL, env });
    await plan();
    const step2 = await P().scheduledMessage.findFirstOrThrow({
      where: { stepId: s.steps[1]!.id },
    });
    await P().campaignAccount.deleteMany({ where: { accountId: c.accountId } });
    await plan();
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).toMatchObject({
      state: "PAUSED",
      stopReason: "ACCOUNT_UNASSIGNED",
    });
    expect((await row(step2.id)).status).toBe("CANCELLED");
    const why = await whyNotSending(P(), clock, s.ws, s.campaign.id, {
      stalenessSec: 300,
      sendable: ALL,
    });
    expect(why.reasons).toContainEqual(
      expect.objectContaining({
        code: "sticky_account_unassigned",
        blocking: false,
        accountIds: [c.accountId],
      }),
    );

    await P().campaignAccount.create({
      data: { campaignId: s.campaign.id, accountId: c.accountId },
    });
    await resumeCampaignLead(P(), s.ws, null, clId);
    await plan();
    expect(await row(step2.id)).toMatchObject({ status: "SCHEDULED", accountId: c.accountId });
  });
});

describe("D53: a restore of an older dump never repeats a send", () => {
  const ALL_SENT = async (s: { accounts: EmailAccount[] }) =>
    (await Promise.all(s.accounts.map(sent))).reduce((x, y) => x + y, 0);
  const plan = (clock: { now(): Date }) =>
    planDue(P(), clock, { stalenessSec: 300, sendableProviders: ALL, env });
  /** Puts the send rows and the lead back as the dump had them; the synced Sent copies stay, matched to no row. */
  async function restore(cl: CampaignLead, rows: ScheduledMessage[]) {
    await P().message.updateMany({ data: { scheduledMessageId: null, outsideApp: true } });
    await P().scheduledMessage.deleteMany({ where: { campaignLeadId: cl.id } });
    for (const r of rows) await P().scheduledMessage.create({ data: r });
    const { id, ...rest } = cl;
    await P().campaignLead.update({ where: { id }, data: rest });
  }
  const tick = (clock: { now(): Date }) =>
    dispatchTick(P(), clock, {
      ...deps(),
      bootId: "boot-1",
      stalenessSec: 300,
      sendableProviders: ALL,
    });
  const toStep2 = async (
    clock: ReturnType<typeof fixedClock>,
    s: { accounts: EmailAccount[] },
    clId: string,
  ) => {
    const due = (await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).nextDueAt!;
    clock.advance(due.getTime() - clock.now().getTime());
    await markFresh(
      P(),
      s.accounts.map((a) => a.id),
      clock.now(),
    );
    await plan(clock);
  };

  test("(a) a row SCHEDULED in the dump and sent after it is settled from its synced Sent copy, not sent again", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}] });
    const clId = s.leads[0]!.cl.id;
    const dumpRow = await P().scheduledMessage.findFirstOrThrow({
      where: { campaignLeadId: clId },
    });
    const dumpCl = await P().campaignLead.findUniqueOrThrow({ where: { id: clId } });
    expect((await tick(clock)).SENT).toBe(1);
    const sentAt = (await row(dumpRow.id)).sentAt;

    clock.advance(3600_000);
    await restore(dumpCl, [dumpRow]);
    await markFresh(P(), [s.accounts[0]!.id], clock.now());
    expect((await tick(clock)).SENT).toBe(1); // settled, not sent
    expect(await ALL_SENT(s)).toBe(1);
    expect(await row(dumpRow.id)).toMatchObject({ status: "SENT", sentAt });
    const msg = await P().message.findFirstOrThrow({ where: { leadId: s.leads[0]!.lead.id } });
    expect(msg).toMatchObject({ scheduledMessageId: dumpRow.id, outsideApp: false });
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).toMatchObject({
      currentStepId: s.steps[1]!.id,
    });
    // the next step still goes out
    await toStep2(clock, s, clId);
    expect((await tick(clock)).SENT).toBe(1);
    expect(await ALL_SENT(s)).toBe(2);
  });

  test("(b) a step planned and sent after the dump is re-planned by the planner and still not sent again", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}, {}] });
    const clId = s.leads[0]!.cl.id;
    expect((await tick(clock)).SENT).toBe(1);
    const dumpRows = await P().scheduledMessage.findMany({ where: { campaignLeadId: clId } });
    const dumpCl = await P().campaignLead.findUniqueOrThrow({ where: { id: clId } });
    await toStep2(clock, s, clId);
    expect((await tick(clock)).SENT).toBe(1);
    expect(await ALL_SENT(s)).toBe(2);

    clock.advance(3600_000);
    await restore(dumpCl, dumpRows);
    await markFresh(
      P(),
      s.accounts.map((a) => a.id),
      clock.now(),
    );
    expect((await plan(clock)).planned).toBe(1); // the step-2 row the dump did not have
    expect((await tick(clock)).SENT).toBe(1); // settled from the Sent copy
    expect(await ALL_SENT(s)).toBe(2);
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).toMatchObject({
      state: "COMPLETED",
    });
  });

  test("(b) a step 1 the dump had not planned, re-planned onto another mailbox, is settled and keeps the real sender", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), {
      at: T,
      leads: 1,
      steps: 2,
      accounts: [{}, { email: `other-${randomBytes(3).toString("hex")}@other.test` }],
    });
    const clId = s.leads[0]!.cl.id;
    const dumpCl = await P().campaignLead.findUniqueOrThrow({ where: { id: clId } });
    await plan(clock);
    expect((await tick(clock)).SENT).toBe(1);
    const realSender = (await P().scheduledMessage.findFirstOrThrow()).accountId;

    clock.advance(3600_000);
    await restore(dumpCl, []);
    await P().campaignAccount.deleteMany({ where: { accountId: realSender } }); // the planner must pick the other one
    await markFresh(
      P(),
      s.accounts.map((a) => a.id),
      clock.now(),
    );
    await plan(clock);
    expect((await P().scheduledMessage.findFirstOrThrow()).accountId).not.toBe(realSender);
    expect((await tick(clock)).SENT).toBe(1);
    expect(await ALL_SENT(s)).toBe(1);
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: clId } })).toMatchObject({
      accountId: realSender,
      currentStepId: s.steps[1]!.id,
    });
  });

  test("a manual reply to the lead from the inbox (same thread subject) does not suppress the next step", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}] });
    const A = s.accounts[0]!;
    const clId = s.leads[0]!.cl.id;
    expect((await tick(clock)).SENT).toBe(1);
    const first = await P().scheduledMessage.findFirstOrThrow({ where: { campaignLeadId: clId } });
    clock.advance(60_000);
    // what sync imports for a reply the owner wrote by hand: our address, the lead, "Re:", in the campaign thread
    await P().$transaction((tx) =>
      ingestMessage(
        tx,
        A,
        {
          providerMessageId: "manual-1",
          rfcMessageId: `<manual-${clId}@send.test>`,
          folder: "SENT",
          inReplyTo: first.rfcMessageId,
          references: [first.rfcMessageId!],
          from: { email: A.email },
          to: [{ email: s.leads[0]!.lead.email }],
          cc: [],
          subject: "Re: Hi",
          date: clock.now(),
          text: "Just checking in",
          html: null,
          headers: {},
          attachments: [],
        },
        { kind: "OUTBOUND" },
        { historical: false },
      ),
    );
    await toStep2(clock, s, clId);
    expect((await tick(clock)).SENT).toBe(1);
    expect(await ALL_SENT(s)).toBe(2);
  });
});
