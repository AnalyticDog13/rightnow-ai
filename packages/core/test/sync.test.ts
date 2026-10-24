import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import {
  getFakeProvider,
  newMessageId,
  type MailProvider,
  type RemoteMessage,
} from "@rightnow/providers";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { resumeAccount } from "../src/accounts/service";
import { fixedClock } from "../src/clock";
import { evaluateHealth } from "../src/deliverability/health";
import type { AiClassifier } from "../src/mail/classify";
import { reconcileAccount, syncDue, type SyncDeps } from "../src/mail/sync";
import { seedCampaign } from "./campaign-fixture";
import { dsn } from "./dsn-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "sync-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());
afterEach(() => void vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

const T = new Date("2026-10-20T10:00:00Z");
const DAY = 86_400_000;
const fake = (a: { email: string }) => getFakeProvider(a.email);
const deps = (o: Partial<SyncDeps> = {}): SyncDeps => ({
  providerFor: async (a) => fake(a),
  env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
  ...o,
});
/** A provider whose methods are wrapped; the rest is the Fake. */
const wrap = (a: { email: string }, o: Partial<MailProvider>): MailProvider =>
  Object.assign(Object.create(fake(a)) as MailProvider, o);

let n = 0;
/** A live, connected account in a sendable campaign with one lead (fixture), never synced yet. */
async function setup(o: { steps?: number; leads?: number } = {}) {
  const s = await seedCampaign(P(), {
    at: T,
    leads: o.leads ?? 1,
    steps: o.steps ?? 1,
    accounts: [{ credentialsEnc: "x", lastSyncCompletedAt: null, email: `sync${++n}@send.test` }],
  });
  // the Fake dates mail with the real clock, to the second: enrolled well before any of it
  await P().campaignLead.updateMany({
    where: { campaignId: s.campaign.id },
    data: { enrolledAt: new Date(T.getTime() - DAY) },
  });
  return { ...s, A: s.accounts[0]! as EmailAccount };
}
const acct = (id: string) => P().emailAccount.findUniqueOrThrow({ where: { id } });
const messages = (accountId: string) => P().message.count({ where: { accountId } });
const run = (clock: { now(): Date }, A: EmailAccount, d = deps()) =>
  reconcileAccount(P(), clock, A.id, d);
const reply = (A: EmailAccount, from: string, text = "Thanks, sounds good.") =>
  fake(A).receiveInbound({ from: { email: from }, subject: "Re: Hi", text });

describe("reconcileAccount", () => {
  test("first sync imports historyImportDays of INBOX and SENT; the watermark is the run's start", async () => {
    const { A } = await setup();
    await reply(A, "someone@x.test");
    await fake(A).sendExternal({ subject: "out", messageId: newMessageId("send.test") });
    const clock = fixedClock(T);
    const since: Date[] = [];
    const p = wrap(A, {
      async listMessages(q) {
        since.push(q.since);
        clock.advance(60_000); // the run takes time: the watermark must stay at its start
        return fake(A).listMessages(q);
      },
    });
    expect(await run(clock, A, deps({ providerFor: async () => p }))).toBe("caught_up");
    expect(since.map((d) => d.getTime())).toEqual([T.getTime() - 30 * DAY, T.getTime() - 30 * DAY]);
    const a = await acct(A.id);
    expect(a).toMatchObject({
      lastSyncCompletedAt: T,
      syncProgress: null,
      syncState: "IDLE",
      syncLeaseId: null,
      syncErrors: 0,
      lastSyncAttemptAt: T,
    });
    expect(a.syncCursor).toMatchObject({ kind: "fake" });
    expect(await messages(A.id)).toBe(2);
    expect(
      await P().message.findFirst({ where: { accountId: A.id, direction: "OUT" } }),
    ).toMatchObject({ outsideApp: true, folder: "SENT" });
    expect(await P().syncRun.findMany({ where: { accountId: A.id } })).toMatchObject([
      { mode: "HISTORICAL", startedAt: T, fetched: 2, error: null },
    ]);
  });

  test("C1: a HISTORICAL import across 2 runs; a reply delivered between them is ingested by the next incremental run", async () => {
    const { A, leads } = await setup();
    await reply(A, "old@x.test");
    const clock = fixedClock(T);
    const d = deps({ maxPages: 1 });
    expect(await run(clock, A, d)).toBe("more"); // INBOX page; SENT still to list
    expect(await acct(A.id)).toMatchObject({
      lastSyncCompletedAt: null,
      syncProgress: { mode: "HISTORICAL", folder: "SENT", startedAt: T.toISOString() },
    });
    await reply(A, leads[0]!.lead.email);
    clock.advance(60_000);
    expect(await run(clock, A, d)).toBe("caught_up");
    expect(await acct(A.id)).toMatchObject({ lastSyncCompletedAt: T, syncProgress: null });
    expect(await messages(A.id)).toBe(1);
    clock.advance(60_000);
    expect(await run(clock, A, d)).toBe("caught_up");
    expect(await messages(A.id)).toBe(2);
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: leads[0]!.cl.id } }),
    ).toMatchObject({
      state: "STOPPED",
      stopReason: "REPLIED",
    });
    expect((await acct(A.id)).lastSyncCompletedAt).toEqual(clock.now());
  });

  test("the watermark waits for stop rules: a reply on page 2 of 2", async () => {
    const { A, leads } = await setup();
    const clock = fixedClock(T);
    expect(await run(clock, A)).toBe("caught_up");
    await reply(A, "unrelated@x.test");
    await reply(A, leads[0]!.lead.email);
    clock.advance(60_000);
    const d = deps({ maxPages: 1, pageSize: 1 });
    expect(await run(clock, A, d)).toBe("more");
    expect((await acct(A.id)).lastSyncCompletedAt).toEqual(T);
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: leads[0]!.cl.id } }),
    ).toMatchObject({
      state: "ACTIVE",
    });
    clock.advance(60_000);
    expect(await run(clock, A, d)).toBe("caught_up");
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: leads[0]!.cl.id } }),
    ).toMatchObject({
      state: "STOPPED",
    });
    expect((await acct(A.id)).lastSyncCompletedAt).toEqual(clock.now());
  });

  test("expired cursor → FULL reconcile without duplicates, across 2 runs; the watermark is its first run's start", async () => {
    const { A } = await setup();
    await reply(A, "a@x.test");
    await fake(A).sendExternal({ subject: "out", messageId: newMessageId("send.test") });
    const clock = fixedClock(T);
    expect(await run(clock, A)).toBe("caught_up");
    const before = (await acct(A.id)).syncCursor as { epoch: number };
    await fake(A).expireCursors();
    clock.advance(3600_000);
    const fullStart = clock.now();
    const d = deps({ maxPages: 1 });
    expect(await run(clock, A, d)).toBe("more");
    expect(await acct(A.id)).toMatchObject({
      lastSyncCompletedAt: T,
      syncProgress: { mode: "FULL", folder: "SENT" },
    });
    await reply(A, "b@x.test");
    clock.advance(60_000);
    expect(await run(clock, A, d)).toBe("caught_up");
    const a = await acct(A.id);
    expect(a.lastSyncCompletedAt).toEqual(fullStart);
    expect((a.syncCursor as { epoch: number }).epoch).toBe(before.epoch + 1);
    expect(await messages(A.id)).toBe(2);
    clock.advance(60_000);
    expect(await run(clock, A, d)).toBe("caught_up");
    expect(await messages(A.id)).toBe(3);
    expect(
      (
        await P().syncRun.findMany({ where: { accountId: A.id }, orderBy: { startedAt: "asc" } })
      ).map((r) => r.mode),
    ).toEqual(["HISTORICAL", "FULL", "FULL", "INCREMENTAL"]);
  });

  test("M11: an invalid listMessages page token restarts that folder from `since`", async () => {
    const { A } = await setup();
    await reply(A, "a@x.test");
    await reply(A, "b@x.test");
    const clock = fixedClock(T);
    const cursor = await fake(A).currentCursor();
    await P().emailAccount.update({
      where: { id: A.id },
      data: {
        syncProgress: {
          mode: "HISTORICAL",
          folder: "INBOX",
          pageToken: "stale",
          since: new Date(T.getTime() - 30 * DAY).toISOString(),
          cursor,
          startedAt: T.toISOString(),
          fetched: 0,
        },
      },
    });
    expect(await run(clock, A)).toBe("caught_up");
    expect(await messages(A.id)).toBe(2);
  });

  test("outside-app send recorded by the incremental sync", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    const id = newMessageId("send.test");
    await fake(A).sendExternal({ subject: "from my phone", messageId: id });
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("caught_up");
    expect(await P().message.findFirstOrThrow({ where: { rfcMessageId: id } })).toMatchObject({
      direction: "OUT",
      outsideApp: true,
      kind: "OUTBOUND",
    });
  });

  test("removed messages get remoteDeletedAt", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await reply(A, "a@x.test");
    await run(clock, A);
    const m = await P().message.findFirstOrThrow({ where: { accountId: A.id } });
    await fake(A).deleteMessage(m.providerMessageId!);
    clock.advance(60_000);
    await run(clock, A);
    expect((await P().message.findUniqueOrThrow({ where: { id: m.id } })).remoteDeletedAt).toEqual(
      clock.now(),
    );
  });

  test("transient errors escalate after 5 failed runs; a caught-up run clears the SYNC error", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    quiet();
    for (let i = 1; i <= 5; i++) {
      fake(A).failNextRead("token_5xx");
      clock.advance(60_000);
      expect(await run(clock, A)).toBe("failed");
      const a = await acct(A.id);
      expect(a).toMatchObject({ syncErrors: i, syncState: "FAILED", syncLeaseId: null });
      expect(a.status).toBe(i < 5 ? "CONNECTED" : "ERROR");
    }
    const a = await acct(A.id);
    expect(a).toMatchObject({
      lifecycle: "ACTIVE",
      lastError: { kind: "SYNC", code: "TransientBeforeSendError" },
      lastErrorAt: clock.now(),
      lastSyncCompletedAt: T,
    });
    const runs = await P().syncRun.findMany({ where: { accountId: A.id, error: { not: null } } });
    expect(runs).toHaveLength(5);
    expect(runs[0]!.error).toBe("TransientBeforeSendError");
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("caught_up");
    expect(await acct(A.id)).toMatchObject({
      status: "CONNECTED",
      lastError: null,
      syncErrors: 0,
      syncState: "IDLE",
      lastSyncCompletedAt: clock.now(),
    });
  });

  test("escalation keeps an earlier SENDING lastError as previous; a caught-up run restores it", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    const sending = { kind: "SENDING", code: "smtp_5xx", message: "permanent send error" };
    await P().emailAccount.update({ where: { id: A.id }, data: { lastError: sending } });
    quiet();
    for (let i = 1; i <= 6; i++) {
      fake(A).failNextRead("token_5xx");
      clock.advance(60_000);
      expect(await run(clock, A)).toBe("failed");
    }
    // a sixth failure re-escalates without nesting SYNC inside SYNC
    expect((await acct(A.id)).lastError).toEqual({
      kind: "SYNC",
      code: "TransientBeforeSendError",
      message: "mailbox sync failed 6 times in a row",
      previous: sending,
    });
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("caught_up");
    expect(await acct(A.id)).toMatchObject({ status: "CONNECTED", lastError: sending });
  });

  test("a health pause and a SYNC escalation nest either way; resume and a caught-up run leave no stale error", async () => {
    quiet();
    const bounces = (A: EmailAccount, at: Date) =>
      P().event.createMany({
        data: [...Array(104).keys()].map((i) => ({
          workspaceId: A.workspaceId,
          type: i < 100 ? ("ACCEPTED" as const) : ("BOUNCE_HARD" as const),
          occurredAt: at,
          accountId: A.id,
          scheduledMessageId: `sm-${A.id}-${i}`,
          dedupeKey: `h:${A.id}:${i}`,
        })),
      });
    const failSync = async (clock: ReturnType<typeof fixedClock>, A: EmailAccount) => {
      for (let i = 0; i < 5; i++) {
        fake(A).failNextRead("token_5xx");
        clock.advance(60_000);
        await run(clock, A);
      }
    };
    const sync = { kind: "SYNC", code: "TransientBeforeSendError" };
    const soft = { kind: "SOFT_BOUNCE", code: "bounce_rate" };

    // SYNC first, then the health pause: SOFT_BOUNCE over SYNC; resume shows the SYNC again; a caught-up run clears it
    const { A, ws } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await failSync(clock, A);
    await bounces(A, clock.now());
    await evaluateHealth(P(), clock);
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "PAUSED",
      status: "ERROR",
      lastError: { ...soft, previous: sync },
    });
    await resumeAccount(P(), ws, A.id, { clock });
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "ACTIVE",
      status: "ERROR",
      lastError: sync,
    });
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("caught_up");
    expect(await acct(A.id)).toMatchObject({ status: "CONNECTED", lastError: null });

    // the sync keeps failing under the health pause: re-escalation drops the SYNC nested in the SOFT_BOUNCE, so a
    // caught-up run leaves no stale SYNC behind it and a resume shows no CONNECTION_ERROR
    const D = (await setup()).A;
    const c4 = fixedClock(T);
    await run(c4, D);
    await failSync(c4, D);
    await bounces(D, c4.now());
    await evaluateHealth(P(), c4);
    fake(D).failNextRead("token_5xx");
    c4.advance(60_000);
    await run(c4, D);
    expect((await acct(D.id)).lastError).toEqual({
      ...sync,
      message: "mailbox sync failed 6 times in a row",
      previous: { ...soft, message: expect.any(String) },
    });
    c4.advance(60_000);
    expect(await run(c4, D)).toBe("caught_up");
    expect((await acct(D.id)).lastError).toEqual({ ...soft, message: expect.any(String) });
    await resumeAccount(P(), D.workspaceId, D.id, { clock: c4 });
    expect(await acct(D.id)).toMatchObject({
      lifecycle: "ACTIVE",
      status: "CONNECTED",
      lastError: null,
    });

    // the same, but the sync recovers while the account is paused
    const B = (await setup()).A;
    const c2 = fixedClock(T);
    await run(c2, B);
    await failSync(c2, B);
    await bounces(B, c2.now());
    await evaluateHealth(P(), c2);
    c2.advance(60_000);
    expect(await run(c2, B)).toBe("caught_up");
    const b = await acct(B.id);
    expect(b).toMatchObject({ lifecycle: "PAUSED", status: "CONNECTED" });
    expect(b.lastError).toEqual(expect.not.objectContaining({ previous: expect.anything() }));

    // health pause first, then SYNC: SYNC over SOFT_BOUNCE; resume drops the SOFT_BOUNCE beneath it
    const C = (await setup()).A;
    const c3 = fixedClock(T);
    await run(c3, C);
    await bounces(C, c3.now());
    await evaluateHealth(P(), c3);
    await failSync(c3, C);
    expect(await acct(C.id)).toMatchObject({ lastError: { ...sync, previous: soft } });
    await resumeAccount(P(), (await acct(C.id)).workspaceId, C.id, { clock: c3 });
    const c = await acct(C.id);
    expect(c).toMatchObject({ lifecycle: "ACTIVE", lastError: sync });
    expect(c.lastError).toEqual(expect.not.objectContaining({ previous: expect.anything() }));
    c3.advance(60_000);
    expect(await run(c3, C)).toBe("caught_up");
    expect(await acct(C.id)).toMatchObject({ status: "CONNECTED", lastError: null });
  });

  test("AuthError → NEEDS_ATTENTION; syncDue then leaves the account alone", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    fake(A).failNextRead("auth_revoked");
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("failed");
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "NEEDS_ATTENTION",
      status: "ERROR",
      lastError: { kind: "CONNECTION" },
      syncLeaseId: null,
      lastSyncCompletedAt: T,
    });
    clock.advance(DAY);
    const spy = vi.fn(async (a: EmailAccount) => fake(a));
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000 });
    expect(spy.mock.calls.map(([a]) => a.id)).not.toContain(A.id);
  });

  test("two workers, one lease: a concurrent run is skipped", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    const slow = deps({
      providerFor: async (a) => (await new Promise((r) => setTimeout(r, 300)), fake(a)),
    });
    const r = await Promise.all([run(clock, A, slow), run(clock, A, slow)]);
    expect(r.sort()).toEqual(["caught_up", "skipped"]);
  });

  test("a lost lease stops the run as skipped and writes nothing more", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    const cursor = (await acct(A.id)).syncCursor;
    await reply(A, "a@x.test");
    const p = wrap(A, {
      async listChangesSince(c, o) {
        await P().emailAccount.update({ where: { id: A.id }, data: { syncLeaseId: "other" } });
        return fake(A).listChangesSince(c, o);
      },
    });
    clock.advance(60_000);
    expect(await run(clock, A, deps({ providerFor: async () => p }))).toBe("skipped");
    expect(await acct(A.id)).toMatchObject({ syncCursor: cursor, lastSyncCompletedAt: T });
  });

  test("the watermark never moves backwards", async () => {
    const { A } = await setup();
    const later = new Date(T.getTime() + 3600_000);
    const clock = fixedClock(T);
    await run(clock, A);
    await P().emailAccount.update({ where: { id: A.id }, data: { lastSyncCompletedAt: later } });
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("caught_up");
    expect((await acct(A.id)).lastSyncCompletedAt).toEqual(later);
  });

  test("an ingest failure blocks freshness: run failed, cursor and watermark unchanged", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    const cursor = (await acct(A.id)).syncCursor;
    await reply(A, "a@x.test");
    vi.spyOn(P(), "$transaction").mockRejectedValueOnce(new Error("db down"));
    quiet();
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("failed");
    expect(await acct(A.id)).toMatchObject({
      syncCursor: cursor,
      lastSyncCompletedAt: T,
      syncErrors: 1,
    });
    expect(await messages(A.id)).toBe(0);
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("caught_up");
    expect(await messages(A.id)).toBe(1);
  });

  test("poison input is sanitized: NUL bytes are stripped, an invalid date becomes the run's start", async () => {
    const { A, leads } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await fake(A).receiveRaw(
      Buffer.from(
        `From: ${leads[0]!.lead.email}\r\nTo: ${A.email}\r\nSubject: Re: Hi\u0000there\r\n` +
          `Date: not a date\r\nMessage-ID: <nul-${n}@x.test>\r\n\r\nSounds good\u0000, let's talk.\r\n`,
      ),
    );
    await reply(A, "nan@x.test");
    const p = wrap(A, {
      async listChangesSince(c, o) {
        const r = await fake(A).listChangesSince(c, o);
        if (r.expired) return r;
        const bad = (m: (typeof r.messages)[0]) => m.from.email === "nan@x.test";
        return {
          ...r,
          messages: r.messages.map((m) => (bad(m) ? { ...m, date: new Date(Number.NaN) } : m)),
        };
      },
    });
    clock.advance(60_000);
    const start = clock.now();
    expect(await run(clock, A, deps({ providerFor: async () => p }))).toBe("caught_up");
    const nul = await P().message.findFirstOrThrow({
      where: { accountId: A.id, fromEmail: leads[0]!.lead.email },
    });
    expect(nul.subject).toBe("Re: Hithere");
    expect(nul.text).not.toContain("\u0000");
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: leads[0]!.cl.id } }),
    ).toMatchObject({ state: "STOPPED", stopReason: "REPLIED" });
    expect(
      (await P().message.findFirstOrThrow({ where: { accountId: A.id, fromEmail: "nan@x.test" } }))
        .sentAt,
    ).toEqual(start);
  });

  /** Wraps the Fake so `edit` rewrites the incremental messages matching `pick`. */
  const rewrite = (
    A: EmailAccount,
    pick: (m: RemoteMessage) => boolean,
    edit: (m: RemoteMessage) => RemoteMessage,
  ) =>
    wrap(A, {
      async listChangesSince(c, o) {
        const r = await fake(A).listChangesSince(c, o);
        return r.expired ? r : { ...r, messages: r.messages.map((m) => (pick(m) ? edit(m) : m)) };
      },
    });
  // base64 of random bytes: incompressible, so it overflows a btree index entry (FR I1)
  const junk = (chars: number) => randomBytes(chars).toString("base64").slice(0, chars);

  test("FR I1: oversized identifiers are dropped or clipped, so the message syncs", async () => {
    const { A, leads } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await reply(A, leads[0]!.lead.email);
    const longAddr = `${junk(400)}@x.test`;
    const p = rewrite(
      A,
      () => true,
      (m) => ({
        ...m,
        rfcMessageId: `<${junk(5000)}@x.test>`,
        inReplyTo: `<${junk(5000)}@x.test>`,
        references: [`<${junk(5000)}@x.test>`, "<ok@x.test>"],
        from: { email: m.from.email, name: junk(5000) },
        to: [...m.to, { email: longAddr }],
        cc: [{ email: longAddr }],
        subject: junk(5000),
      }),
    );
    clock.advance(60_000);
    expect(await run(clock, A, deps({ providerFor: async () => p }))).toBe("caught_up");
    const m = await P().message.findFirstOrThrow({ where: { accountId: A.id, direction: "IN" } });
    expect(m).toMatchObject({ synthetic: true, inReplyTo: null, references: ["<ok@x.test>"] });
    expect(m.fromName!.length).toBe(998);
    expect(m.subject.length).toBe(998);
    expect(m.to[1]!.length).toBe(320);
    expect(m.cc[0]!.length).toBe(320);
  });

  test("a multibyte Message-ID over the index byte limit is stored synthetic; the reply still stops the lead", async () => {
    const { A, leads } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await reply(A, leads[0]!.lead.email);
    const emoji = Array.from({ length: 990 }, () =>
      String.fromCharCode(0x4e00 + Math.floor(Math.random() * 0x4000)),
    ).join(""); // 990 chars <= 998 but ~2970 random 3-byte bytes: over the btree limit even compressed
    const p = rewrite(
      A,
      () => true,
      (m) => ({
        ...m,
        rfcMessageId: `<${emoji}>`,
        inReplyTo: `<${emoji}>`,
        references: [`<${emoji}>`],
      }),
    );
    clock.advance(60_000);
    const at = clock.now();
    expect(await run(clock, A, deps({ providerFor: async () => p }))).toBe("caught_up");
    const m = await P().message.findFirstOrThrow({ where: { accountId: A.id, direction: "IN" } });
    expect(m).toMatchObject({ synthetic: true, inReplyTo: null, references: [] });
    expect(m.rfcMessageId).toContain("synthetic");
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: leads[0]!.cl.id } }),
    ).toMatchObject({ state: "STOPPED", stopReason: "REPLIED" });
    expect((await acct(A.id)).lastSyncCompletedAt).toEqual(at);
  });

  test("PA #1: a message that always fails is stored as a header-only placeholder on its 3rd failed run", async () => {
    const { A, leads } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await reply(A, leads[0]!.lead.email);
    // an Int overflow Prisma refuses: only the full ingest carries attachments
    const p = rewrite(
      A,
      (m) => m.from.email === leads[0]!.lead.email,
      (m) => ({
        ...m,
        attachments: [
          { filename: "a.pdf", contentType: "application/pdf", size: 2 ** 40, content: null },
        ],
      }),
    );
    const d = deps({ providerFor: async () => p });
    quiet();
    for (let i = 0; i < 2; i++) {
      clock.advance(60_000);
      expect(await run(clock, A, d)).toBe("failed");
    }
    expect(await messages(A.id)).toBe(0);
    clock.advance(60_000);
    const third = clock.now();
    expect(await run(clock, A, d)).toBe("caught_up");
    const m = await P().message.findFirstOrThrow({
      where: { accountId: A.id },
      include: { attachments: true },
    });
    expect(m).toMatchObject({
      text: null,
      html: null,
      attachments: [],
      fromEmail: leads[0]!.lead.email,
    });
    expect(m).toMatchObject({ synthetic: true });
    expect(m.rfcMessageId).toContain("synthetic");
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: leads[0]!.cl.id } }),
    ).toMatchObject({ state: "STOPPED", stopReason: "REPLIED" });
    expect((await acct(A.id)).lastSyncCompletedAt).toEqual(third);
    const runs = await P().syncRun.findMany({
      where: { accountId: A.id },
      orderBy: { startedAt: "desc" },
      take: 3,
    });
    expect(runs[0]!.error).toMatch(/^placeholder \S+ msg=/);
    expect(runs[1]!.error).toMatch(/ msg=/);
  });

  test("the AI classifier is not asked again for a message already stored", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await reply(A, "a@x.test", "Hmm.");
    let calls = 0;
    const ai: AiClassifier = async () => (calls++, { category: "INTERESTED" });
    const aiClassify = { aiClassifyFor: async () => ai };
    clock.advance(60_000);
    await run(clock, A, deps(aiClassify));
    await fake(A).expireCursors(); // the FULL reconcile lists the same message again
    clock.advance(60_000);
    expect(await run(clock, A, deps(aiClassify))).toBe("caught_up");
    expect(calls).toBe(1);
  });

  test("an AI classifier that ignores its abort signal is cut off at 10 s", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await reply(A, "a@x.test", "Hmm.");
    const aiClassify = { aiClassifyFor: async () => (() => new Promise(() => {})) as AiClassifier }; // never settles
    clock.advance(60_000);
    const t0 = Date.now();
    expect(await run(clock, A, deps(aiClassify))).toBe("caught_up");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(9_900);
    expect(await P().message.findFirstOrThrow({ where: { accountId: A.id } })).toMatchObject({
      category: "UNCERTAIN",
    });
  }, 30_000);

  test("the AI classifier refines an UNCERTAIN reply; its failure is ignored", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await reply(A, "a@x.test", "Hmm.");
    await reply(A, "b@x.test", "Hmm?");
    let calls = 0;
    const ai: AiClassifier = async (m) => {
      calls++;
      if (m.text?.includes("?")) throw new Error("model down");
      return { category: "INTERESTED" };
    };
    const aiClassify = { aiClassifyFor: async () => ai };
    clock.advance(60_000);
    expect(await run(clock, A, deps(aiClassify))).toBe("caught_up");
    expect(calls).toBe(2);
    const cats = await P().message.findMany({
      where: { accountId: A.id },
      orderBy: { fromEmail: "asc" },
      select: { category: true },
    });
    expect(cats.map((c) => c.category)).toEqual(["INTERESTED", "UNCERTAIN"]);
  });

  test("SyncRun keeps the newest 50 per account", async () => {
    const { A } = await setup();
    await P().syncRun.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        accountId: A.id,
        mode: "INCREMENTAL" as const,
        startedAt: new Date(T.getTime() - (i + 1) * 60_000),
      })),
    });
    await run(fixedClock(T), A);
    expect(await P().syncRun.count({ where: { accountId: A.id } })).toBe(50);
    expect(
      await P().syncRun.findFirst({ where: { accountId: A.id, startedAt: T } }),
    ).not.toBeNull();
  });
});

describe("syncDue", () => {
  test("due: never attempted, poll interval passed, or the last run was `more`; backoff after errors", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    const synced = vi.fn(async (a: EmailAccount) => fake(a));
    const due = async () => {
      synced.mockClear();
      await syncDue(P(), clock, deps({ providerFor: synced }), { maxMs: 10_000 });
      return synced.mock.calls.some(([a]) => a.id === A.id);
    };
    expect(await due()).toBe(true); // never attempted
    clock.advance(119_000);
    expect(await due()).toBe(false);
    clock.advance(1_000);
    expect(await due()).toBe(true);

    // `more` is due on the next tick
    await reply(A, "a@x.test");
    await reply(A, "b@x.test");
    clock.advance(120_000);
    expect(await reconcileAccount(P(), clock, A.id, deps({ maxPages: 1, pageSize: 1 }))).toBe(
      "more",
    );
    clock.advance(1_000);
    expect(await due()).toBe(true);

    // syncErrors 3: min(120 · 2^2, 1800) = 480 s
    await P().emailAccount.update({
      where: { id: A.id },
      data: { syncErrors: 3, syncState: "FAILED", lastSyncAttemptAt: clock.now() },
    });
    clock.advance(479_000);
    expect(await due()).toBe(false);
    await P().emailAccount.update({
      where: { id: A.id },
      data: { syncErrors: 3, syncState: "FAILED" },
    });
    clock.advance(1_000);
    expect(await due()).toBe(true);
  });

  test("returns synced/failed counts and starts nothing once the signal fired", async () => {
    const { A } = await setup();
    const clock = fixedClock(new Date(T.getTime() + 400 * DAY));
    const ac = new AbortController();
    ac.abort();
    const spy = vi.fn(async (a: EmailAccount) => fake(a));
    expect(
      await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000, signal: ac.signal }),
    ).toEqual({ synced: 0, failed: 0 });
    expect(spy).not.toHaveBeenCalled();
    fake(A).failNextRead("token_5xx");
    quiet();
    const r = await syncDue(P(), clock, deps(), { maxMs: 10_000 });
    expect(r.failed).toBeGreaterThanOrEqual(1);
  });
});

describe("non-lead mail (PS-CRM-12)", () => {
  const off = (ws: string) =>
    P().workspace.update({ where: { id: ws }, data: { storeNonLeadMail: false } });
  const stored = (accountId: string, fromEmail: string) =>
    P().message.findMany({ where: { accountId, fromEmail }, select: { kind: true } });

  test("off: a non-lead reply is dropped (never sent to the AI), the cursor still advances", async () => {
    const { A, ws } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await off(ws);
    const cursor = (await acct(A.id)).syncCursor;
    await reply(A, "news@letter.test", "Big news this week.");
    await reply(A, "hmm@x.test", "Hmm.");
    let calls = 0;
    const ai: AiClassifier = async () => (calls++, { category: "INTERESTED" });
    clock.advance(60_000);
    expect(await run(clock, A, deps({ aiClassifyFor: async () => ai }))).toBe("caught_up");
    expect(await stored(A.id, "news@letter.test")).toEqual([]);
    expect(await stored(A.id, "hmm@x.test")).toEqual([]);
    expect(calls).toBe(0);
    const a = await acct(A.id);
    expect(a.syncCursor).not.toEqual(cursor);
    expect(a.lastSyncCompletedAt).toEqual(clock.now());
  });

  test("off: thread replies, lead replies, DSNs and unsubscribes are still processed", async () => {
    const { A, ws, leads } = await setup();
    const clock = fixedClock(T);
    const first = await reply(A, "known@x.test", "Hello there.");
    await run(clock, A); // stored while the setting is on: the thread exists
    await off(ws);
    await fake(A).receiveInbound({
      from: { email: "known@x.test" },
      subject: "Re: Hi",
      text: "Following up.",
      inReplyTo: first.rfcMessageId,
    });
    await reply(A, leads[0]!.lead.email, "Sounds good.");
    await fake(A).receiveRaw(dsn(A.email, "ghost@x.test", "<nope@send.test>", T));
    await reply(A, "stranger@x.test", "unsubscribe");
    clock.advance(60_000);
    expect(await run(clock, A)).toBe("caught_up");
    expect(await stored(A.id, "known@x.test")).toHaveLength(2);
    expect(await stored(A.id, leads[0]!.lead.email)).toHaveLength(1);
    expect(await stored(A.id, "mailer-daemon@googlemail.com")).toEqual([{ kind: "BOUNCE" }]);
    expect(await stored(A.id, "stranger@x.test")).toEqual([{ kind: "UNSUBSCRIBE" }]);
  });

  test("on (the default): a non-lead reply is stored as today", async () => {
    const { A, ws } = await setup();
    expect((await P().workspace.findUniqueOrThrow({ where: { id: ws } })).storeNonLeadMail).toBe(
      true,
    );
    await reply(A, "news@letter.test", "Big news this week.");
    await run(fixedClock(T), A);
    expect(await stored(A.id, "news@letter.test")).toEqual([{ kind: "REPLY" }]);
  });
});
