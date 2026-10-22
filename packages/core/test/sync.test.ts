import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider, newMessageId, type MailProvider } from "@rightnow/providers";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { fixedClock } from "../src/clock";
import { reconcileAccount, syncDue, type SyncDeps } from "../src/mail/sync";
import { seedCampaign } from "./campaign-fixture";

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
  env: { SYNC_POLL_SEC: 120 },
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

  test("the AI classifier is not asked again for a message already stored", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await reply(A, "a@x.test", "Hmm.");
    let calls = 0;
    const aiClassify: SyncDeps["aiClassify"] = async () => (calls++, "INTERESTED");
    clock.advance(60_000);
    await run(clock, A, deps({ aiClassify }));
    await fake(A).expireCursors(); // the FULL reconcile lists the same message again
    clock.advance(60_000);
    expect(await run(clock, A, deps({ aiClassify }))).toBe("caught_up");
    expect(calls).toBe(1);
  });

  test("an AI classifier that ignores its abort signal is cut off at 10 s", async () => {
    const { A } = await setup();
    const clock = fixedClock(T);
    await run(clock, A);
    await reply(A, "a@x.test", "Hmm.");
    const aiClassify: SyncDeps["aiClassify"] = () => new Promise(() => {}); // never settles
    clock.advance(60_000);
    const t0 = Date.now();
    expect(await run(clock, A, deps({ aiClassify }))).toBe("caught_up");
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
    const aiClassify: SyncDeps["aiClassify"] = async (m) => {
      calls++;
      if (m.text?.includes("?")) throw new Error("model down");
      return "INTERESTED";
    };
    clock.advance(60_000);
    expect(await run(clock, A, deps({ aiClassify }))).toBe("caught_up");
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
