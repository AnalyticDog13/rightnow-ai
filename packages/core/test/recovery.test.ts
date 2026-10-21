import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountProvider } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import {
  AmbiguousSendError,
  PermanentSendError,
  TransientBeforeSendError,
  getFakeProvider,
  type MailProvider,
  type OutboundMime,
  type SendResult,
} from "@rightnow/providers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fixedClock, type Clock } from "../src/clock";
import { claimDue } from "../src/dispatch";
import { gdprDeleteLead } from "../src/leads/service";
import { planDue } from "../src/planner";
import { recoverExpired, resolveUncertain } from "../src/recovery";
import { cancelScheduled, listScheduled, releaseHeld, retryFailed } from "../src/scheduled";
import { dispatchTick, sendClaimed, type SenderDeps } from "../src/sender";
import { unsubscribeKeys, type RenderEnv } from "../src/unsubscribe";
import { markFresh, seedCampaign } from "./campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "recovery-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.drop();
});

const ALL: AccountProvider[] = ["GMAIL", "MICROSOFT", "SMTP"];
const T = new Date("2026-10-20T10:00:00Z"); // Tuesday
const MIN = 60_000;
const HOUR = 60 * MIN;
const env: RenderEnv = {
  appUrl: "https://app.example.com",
  unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
};
const fake = (a: { email: string }) => getFakeProvider(a.email);
const deps = (o: Partial<SenderDeps> = {}): SenderDeps => ({
  providerFor: fake,
  env,
  random: () => 0,
  ...o,
});
const row = (id: string) => P().scheduledMessage.findUniqueOrThrow({ where: { id } });
const lead = (id: string) => P().campaignLead.findUniqueOrThrow({ where: { id } });
const usage = async (accountId: string) =>
  (await P().accountDailyUsage.findMany({ where: { accountId }, orderBy: { day: "asc" } })).map(
    (u) => [u.sent, u.reserved],
  );
const sent = async (a: { email: string }) => (await fake(a).sentRaw()).length;
async function claim(clock: Clock) {
  const [c] = await claimDue(P(), clock, {
    limit: 1,
    bootId: "boot-1",
    stalenessSec: 300,
    sendableProviders: ALL,
    env,
  });
  if (!c) throw new Error("nothing claimed");
  return c;
}
async function tick(clock: Clock, accountIds: string[]) {
  await markFresh(P(), accountIds, clock.now());
  return dispatchTick(P(), clock, {
    ...deps(),
    bootId: "boot-1",
    stalenessSec: 300,
    sendableProviders: ALL,
    maxMs: 5_000,
  });
}
const plan = (clock: Clock) =>
  planDue(P(), clock, { stalenessSec: 300, sendableProviders: ALL, env });

/** Delegates to the Fake, counting findSent calls and recording the hints. */
function spy(
  a: { email: string },
  o: { findSent?: (id: string) => Promise<unknown> } = {},
): MailProvider & { calls: { id: string; hint?: { providerMessageId?: string } }[] } {
  const calls: { id: string; hint?: { providerMessageId?: string } }[] = [];
  return Object.assign(Object.create(fake(a)) as MailProvider, {
    calls,
    async findSent(id: string, hint?: { providerMessageId?: string }) {
      calls.push({ id, hint });
      return o.findSent ? o.findSent(id) : fake(a).findSent(id);
    },
  });
}
const throwing = (a: { email: string }, e: () => unknown): MailProvider =>
  Object.assign(Object.create(fake(a)) as MailProvider, {
    async send(): Promise<SendResult> {
      throw e();
    },
  });
/** The provider accepts the message, then the worker "dies": the promise never settles, so nothing is recorded. */
const dying = (a: { email: string }): MailProvider =>
  Object.assign(Object.create(fake(a)) as MailProvider, {
    async send(m: OutboundMime): Promise<SendResult> {
      await fake(a).send(m);
      return new Promise<SendResult>(() => {});
    },
  });

/** A claimed row that ended UNCERTAIN (ambiguous send) without reaching the mailbox. */
async function uncertain(clock: Clock) {
  const c = await claim(clock);
  const out = await sendClaimed(
    P(),
    clock,
    deps({ providerFor: (a) => throwing(a, () => new AmbiguousSendError("timeout")) }),
    c,
  );
  expect(out).toBe("UNCERTAIN");
  return c;
}
/** UNCERTAIN, not found twice 15 min apart: HELD. The clock ends 15 min later. */
async function held(clock: ReturnType<typeof fixedClock>) {
  const c = await uncertain(clock);
  await resolveUncertain(P(), clock, { providerFor: fake });
  clock.advance(15 * MIN);
  expect(await resolveUncertain(P(), clock, { providerFor: fake })).toMatchObject({ held: 1 });
  expect((await row(c.id)).status).toBe("HELD");
  return c;
}

describe("recoverExpired + resolveUncertain", () => {
  test("uncertain send never auto-resent (Review Focus #1)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}] });
    const A = s.accounts[0]!;
    const ids = [A.id];
    const c = await claim(clock);
    void sendClaimed(P(), clock, deps({ providerFor: dying }), c); // the worker died after the provider accepted
    await expect.poll(() => sent(A)).toBe(1);

    clock.advance(9 * MIN + 59_000);
    expect(await recoverExpired(P(), clock, 600)).toBe(0);
    expect((await row(c.id)).status).toBe("SENDING");
    await tick(clock, ids);
    clock.advance(2_000);
    expect(await recoverExpired(P(), clock, 600)).toBe(1);
    expect(await row(c.id)).toMatchObject({ status: "UNCERTAIN", uncertainAt: clock.now() });
    await tick(clock, ids);

    expect(await resolveUncertain(P(), clock, { providerFor: fake })).toEqual({
      sent: 1,
      held: 0,
      searched: 1,
      errors: 0,
    });
    const r = await row(c.id);
    expect(r.status).toBe("SENT");
    expect(r.sentAt).not.toBeNull();
    expect(r.providerMessageId).toMatch(/^fake-/);
    expect(await usage(A.id)).toEqual([[1, 0]]);
    const cl = await lead(c.campaignLeadId);
    expect(cl).toMatchObject({ accountId: A.id, currentStepId: s.steps[1]!.id });
    await tick(clock, ids);
    expect(await sent(A)).toBe(1);
  });

  test("never SCHEDULED: an expired SENDING row is only ever made UNCERTAIN", async () => {
    const clock = fixedClock(T);
    await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const c = await claim(clock);
    clock.advance(600_001);
    expect(await recoverExpired(P(), clock)).toBe(1); // default lease 600 s
    expect(await row(c.id)).toMatchObject({ status: "UNCERTAIN", claimToken: c.claimToken });
    expect(await recoverExpired(P(), clock)).toBe(0);
  });

  test("not found: searched once, re-searched after 15 min, then HELD with the reservation released", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await uncertain(clock);
    const p = spy(A);
    expect(await resolveUncertain(P(), clock, { providerFor: () => p })).toMatchObject({
      searched: 1,
      held: 0,
    });
    expect(await row(c.id)).toMatchObject({ status: "UNCERTAIN", searchCount: 1 });
    clock.advance(14 * MIN);
    await resolveUncertain(P(), clock, { providerFor: () => p });
    expect(p.calls).toHaveLength(1);
    clock.advance(MIN);
    expect(await resolveUncertain(P(), clock, { providerFor: () => p })).toMatchObject({ held: 1 });
    expect(p.calls).toHaveLength(2);
    expect((await row(c.id)).status).toBe("HELD");
    expect(await usage(A.id)).toEqual([[0, 0]]);
    for (let i = 0; i < 3; i++) await tick(clock, [A.id]);
    expect(await sent(A)).toBe(0);
    expect((await row(c.id)).status).toBe("HELD");
  });

  test("findSent throws: the row stays UNCERTAIN with searchCount 0", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const c = await uncertain(clock);
    const p = spy(s.accounts[0]!, {
      findSent: () => Promise.reject(new TransientBeforeSendError("connect_refused")),
    });
    expect(await resolveUncertain(P(), clock, { providerFor: () => p })).toMatchObject({
      errors: 1,
      searched: 0,
    });
    expect(await row(c.id)).toMatchObject({ status: "UNCERTAIN", searchCount: 0 });
  });

  test("a provider that cannot be built counts as an error, other rows still resolve (I5)", async () => {
    const clock = fixedClock(T);
    await seedCampaign(P(), { at: T, rows: 2, accounts: [{}, {}] });
    const c1 = await uncertain(clock);
    const c2 = await uncertain(clock);
    const bad = c1.accountId;
    expect(
      await resolveUncertain(P(), clock, {
        providerFor: (a) => {
          if (a.id === bad) throw new Error("no provider");
          return fake(a);
        },
      }),
    ).toMatchObject({ errors: 1, searched: 1 });
    expect((await row(c1.id)).searchCount).toBe(0);
    expect((await row(c2.id)).searchCount).toBe(1);
  });

  test("uncertain is capped at 24 h after two failed attempts 15 min apart (I2); the lead can then be GDPR-deleted", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await uncertain(clock);
    const p = spy(A, { findSent: () => Promise.reject(new TransientBeforeSendError("x")) });
    await resolveUncertain(P(), clock, { providerFor: () => p });
    clock.advance(23 * HOUR + 45 * MIN);
    await resolveUncertain(P(), clock, { providerFor: () => p });
    clock.advance(14 * MIN); // +23h59m
    await resolveUncertain(P(), clock, { providerFor: () => p });
    expect((await row(c.id)).status).toBe("UNCERTAIN");
    clock.advance(2 * MIN); // +24h01m
    expect(await resolveUncertain(P(), clock, { providerFor: () => p })).toMatchObject({ held: 1 });
    expect((await row(c.id)).status).toBe("HELD");
    expect(await usage(A.id)).toEqual([[0, 0]]);
    await gdprDeleteLead(P(), clock, s.ws, s.leads[0]!.lead.id); // no 409 send_in_progress
  });

  test("a machine that slept past 24 h searches twice, 15 min apart, before holding (Revision 3)", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 2, accounts: [{}] });
    const A = s.accounts[0]!;
    const c1 = await uncertain(clock);
    const c2 = await uncertain(clock);
    // c1's message did go out (its copy is in Sent); c2's mailbox search fails
    const r1 = await row(c1.id);
    await fake(A).sendExternal({ subject: "Hi", messageId: r1.rfcMessageId! });
    clock.advance(25 * HOUR);
    const p = spy(A, {
      findSent: (id) =>
        id === r1.rfcMessageId
          ? fake(A).findSent(id)
          : Promise.reject(new TransientBeforeSendError("offline")),
    });
    expect(await resolveUncertain(P(), clock, { providerFor: () => p })).toMatchObject({
      sent: 1,
      held: 0,
      errors: 1,
    });
    expect((await row(c1.id)).status).toBe("SENT");
    expect((await row(c2.id)).status).toBe("UNCERTAIN");
    // one failed search on wake (network not up yet) never holds by itself
    clock.advance(5 * MIN);
    expect(await resolveUncertain(P(), clock, { providerFor: () => p })).toMatchObject({ held: 0 });
    expect((await row(c2.id)).status).toBe("UNCERTAIN");
    clock.advance(10 * MIN);
    expect(await resolveUncertain(P(), clock, { providerFor: () => p })).toMatchObject({ held: 1 });
    expect((await row(c2.id)).status).toBe("HELD");
    expect(p.calls.filter((x) => x.id !== r1.rfcMessageId)).toHaveLength(2);
  });

  test("the Graph draft id reaches findSent as the hint", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const c = await claim(clock);
    const e = new AmbiguousSendError("timeout");
    e.providerMessageId = "d-1";
    await sendClaimed(P(), clock, deps({ providerFor: (a) => throwing(a, () => e) }), c);
    const p = spy(s.accounts[0]!);
    await resolveUncertain(P(), clock, { providerFor: () => p });
    expect(p.calls).toEqual([{ id: c.rfcMessageId, hint: { providerMessageId: "d-1" } }]);
  });

  test("a found message on a STOPPED lead is SENT but never revives the lead", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await uncertain(clock);
    await fake(A).sendExternal({ subject: "Hi", messageId: c.rfcMessageId });
    await P().campaignLead.update({
      where: { id: c.campaignLeadId },
      data: { state: "STOPPED", stopReason: "MANUAL" },
    });
    expect(await resolveUncertain(P(), clock, { providerFor: fake })).toMatchObject({ sent: 1 });
    expect(await lead(c.campaignLeadId)).toMatchObject({
      state: "STOPPED",
      stopReason: "MANUAL",
      currentStepId: s.steps[0]!.id,
    });
    expect(await usage(A.id)).toEqual([[1, 0]]);
  });
});

describe("HELD release / cancel / retry", () => {
  test("releaseHeld: confirm required; the next tick sends with the same rfcMessageId", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}] });
    const A = s.accounts[0]!;
    const c = await held(clock);
    await expect(releaseHeld(P(), clock, s.ws, c.id, null, {})).rejects.toMatchObject({
      status: 400,
    });
    await releaseHeld(P(), clock, s.ws, c.id, "user-1", { confirm: true });
    expect(await row(c.id)).toMatchObject({
      status: "SCHEDULED",
      dueAt: clock.now(),
      rfcMessageId: c.rfcMessageId,
      searchCount: 0,
      lastSearchAt: null,
    });
    expect(
      await P().auditLog.findMany({ where: { action: "message.release", target: c.id } }),
    ).toHaveLength(1);
    expect(await tick(clock, [A.id])).toMatchObject({ SENT: 1 });
    const raw = await fake(A).sentRaw();
    expect(raw).toHaveLength(1);
    expect(raw[0]!.toString()).toContain(c.rfcMessageId);
    expect((await row(c.id)).status).toBe("SENT");
  });

  test("releaseHeld: 409 when not HELD, when the step is not current, when the lead is STOPPED; 404 foreign", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}] });
    const c = await held(clock);
    const go = (ws = s.ws) => releaseHeld(P(), clock, ws, c.id, null, { confirm: true });
    await expect(go("other-ws")).rejects.toMatchObject({ status: 404 });
    await P().campaignLead.update({
      where: { id: c.campaignLeadId },
      data: { currentStepId: s.steps[1]!.id },
    }); // moved on (e.g. into a subsequence)
    await expect(go()).rejects.toMatchObject({ status: 409 });
    await P().campaignLead.update({
      where: { id: c.campaignLeadId },
      data: { currentStepId: s.steps[0]!.id, state: "STOPPED", stopReason: "MANUAL" },
    });
    await expect(go()).rejects.toMatchObject({ status: 409 });
    expect((await row(c.id)).status).toBe("HELD");
    await P().scheduledMessage.update({ where: { id: c.id }, data: { status: "SENT" } });
    await expect(go()).rejects.toMatchObject({ status: 409 });
  });

  /** Lead on step 2 of 3 with its step-2 row SCHEDULED (step 1 SENT). */
  async function onStep2(clock: ReturnType<typeof fixedClock>) {
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 3, accounts: [{}] });
    const A = s.accounts[0]!;
    expect(await tick(clock, [A.id])).toMatchObject({ SENT: 1 });
    const clId = s.leads[0]!.cl.id;
    const due = (await lead(clId)).nextDueAt!;
    clock.advance(due.getTime() - clock.now().getTime());
    await markFresh(P(), [A.id], clock.now());
    await plan(clock);
    const r = await P().scheduledMessage.findFirstOrThrow({
      where: { campaignLeadId: clId, stepId: s.steps[1]!.id },
    });
    return { s, A, clId, r };
  }

  test("cancelled HELD row is never re-sent (C1)", async () => {
    const clock = fixedClock(T);
    const { s, A, clId, r } = await onStep2(clock);
    await markFresh(P(), [A.id], clock.now());
    const c = await held(clock);
    expect(c.id).toBe(r.id);
    await cancelScheduled(P(), clock, s.ws, r.id, "user-1");
    expect(
      await P().auditLog.findMany({ where: { action: "message.cancel", target: r.id } }),
    ).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      await markFresh(P(), [A.id], clock.now());
      await plan(clock);
      await tick(clock, [A.id]);
    }
    expect((await row(r.id)).status).toBe("CANCELLED");
    expect(await sent(A)).toBe(1);
    expect((await lead(clId)).currentStepId).toBe(s.steps[2]!.id);
  });

  test("cancelled SCHEDULED row is never re-sent (C1); a SENT row cannot be cancelled", async () => {
    const clock = fixedClock(T);
    const { s, A, clId, r } = await onStep2(clock);
    await cancelScheduled(P(), clock, s.ws, r.id, null);
    for (let i = 0; i < 3; i++) {
      await markFresh(P(), [A.id], clock.now());
      await plan(clock);
      await tick(clock, [A.id]);
    }
    expect((await row(r.id)).status).toBe("CANCELLED");
    expect(await sent(A)).toBe(1);
    expect((await lead(clId)).currentStepId).toBe(s.steps[2]!.id);
    const first = await P().scheduledMessage.findFirstOrThrow({ where: { status: "SENT" } });
    await expect(cancelScheduled(P(), clock, s.ws, first.id, null)).rejects.toMatchObject({
      status: 409,
    });
  });

  test("retryFailed: FAILED → SCHEDULED and the lead ACTIVE; 409 when the step is not current", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 1, steps: 2, accounts: [{}] });
    const c = await claim(clock);
    const out = await sendClaimed(
      P(),
      clock,
      deps({ providerFor: (a) => throwing(a, () => new PermanentSendError("smtp_5xx")) }),
      c,
    );
    expect(out).toBe("FAILED");
    expect(await lead(c.campaignLeadId)).toMatchObject({
      state: "PAUSED",
      stopReason: "SEND_FAILED",
    });
    await P().campaignLead.update({
      where: { id: c.campaignLeadId },
      data: { currentStepId: s.steps[1]!.id },
    });
    await expect(retryFailed(P(), clock, s.ws, c.id, null)).rejects.toMatchObject({
      status: 409,
    });
    await P().campaignLead.update({
      where: { id: c.campaignLeadId },
      data: { currentStepId: s.steps[0]!.id },
    });
    await retryFailed(P(), clock, s.ws, c.id, "user-1");
    expect(await row(c.id)).toMatchObject({ status: "SCHEDULED", attempts: 0, error: null });
    expect(await lead(c.campaignLeadId)).toMatchObject({ state: "ACTIVE", stopReason: null });
    expect(await P().auditLog.count({ where: { action: "message.retry" } })).toBe(1);
    expect(await tick(clock, [s.accounts[0]!.id])).toMatchObject({ SENT: 1 });
  });

  test("listScheduled filters by status and pages by cursor", async () => {
    const clock = fixedClock(T);
    const s = await seedCampaign(P(), { at: T, rows: 3, accounts: [{}] });
    const c = await held(clock);
    const h = await listScheduled(P(), s.ws, { status: "HELD" });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      id: c.id,
      status: "HELD",
      renderedSubject: "Hi",
      leadEmail: s.leads.find((l) => l.cl.id === c.campaignLeadId)!.lead.email,
      accountEmail: s.accounts[0]!.email,
    });
    const p1 = await listScheduled(P(), s.ws, { take: 2 });
    expect(p1.rows).toHaveLength(2);
    const p2 = await listScheduled(P(), s.ws, { take: 2, cursor: p1.nextCursor! });
    expect(p2.rows).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect((await listScheduled(P(), "other-ws", {})).rows).toEqual([]);
  });
});
