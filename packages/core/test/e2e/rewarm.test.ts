import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount, Prisma, PrismaClient } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resumeAccount } from "../../src/accounts/service";
import { reconnectSmtpAccount } from "../../src/accounts/smtp-connect";
import type { Clock } from "../../src/clock";
import { evaluateHealth } from "../../src/deliverability/health";
import { rewarmPlanView, startRewarm } from "../../src/deliverability/rewarm";
import { syncDue } from "../../src/mail/sync";
import { planDue } from "../../src/planner";
import { effectiveAllowance } from "../../src/quota";
import { dispatchTick } from "../../src/sender";
import { unsubscribeKeys } from "../../src/unsubscribe";
import { testEnv } from "../accounts-fixture";
import { seedCampaign } from "../campaign-fixture";
import { fakeResolver } from "../dns-fixture";
import { dsn } from "../dsn-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "rewarm-e2e-"));
testEnv(); // setCredentials (scenario 3) encrypts

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const START = new Date("2026-10-19T09:00:00Z"); // Monday, day 0
const env = {
  appUrl: "https://app.example.com",
  unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
};
const sendOpts = { stalenessSec: 300, sendableProviders: ["SMTP" as const] };
const fake = (a: { email: string }) => getFakeProvider(a.email);
const syncDeps = {
  providerFor: async (a: EmailAccount) => fake(a),
  env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
};
const resolver = fakeResolver({ "send.test/TXT": [["v=spf1 ip4:192.0.2.1 -all"]] });

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.drop());

/**
 * One SMTP account in an ACTIVE campaign with a step-1 backlog of 60 leads, last campaign send `idle` days before day
 * 0. The worker is simulated: on each day a tick (sync, health, plan, dispatch) runs at 09:00, 11:00, 13:00, 15:00.
 */
async function world(
  P: PrismaClient,
  o: {
    idle: number;
    autoRewarm: "AUTO" | "RECOMMEND";
    account?: Partial<Prisma.EmailAccountUncheckedCreateInput>;
    rowsAt?: Date;
  },
) {
  const s = await seedCampaign(P, {
    at: o.rowsAt ?? START,
    rows: 60,
    workspace: { autoRewarm: o.autoRewarm, inactivityDays: 30 },
    accounts: [
      {
        credentialsEnc: "x",
        dailyLimit: 30,
        lastSyncCompletedAt: null,
        createdAt: new Date(START.getTime() - 200 * DAY),
        lastSentAt: new Date(START.getTime() - o.idle * DAY),
        ...o.account,
      },
    ],
  });
  const A = s.accounts[0]!;
  let t = START.getTime();
  const clock: Clock = { now: () => new Date(t) };
  const tick = async () => {
    await syncDue(P, clock, syncDeps);
    await evaluateHealth(P, clock);
    await planDue(P, clock, { ...sendOpts, env });
    await dispatchTick(P, clock, {
      providerFor: fake,
      env,
      random: () => 0,
      bootId: "b",
      ...sendOpts,
    });
  };
  const sentOn = (d: number) =>
    P.scheduledMessage.count({
      where: {
        accountId: A.id,
        status: "SENT",
        sentAt: {
          gte: new Date(START.getTime() + d * DAY - 9 * HOUR),
          lt: new Date(START.getTime() + (d + 1) * DAY - 9 * HOUR),
        },
      },
    });
  /** Day `d` from 09:00 to 15:00 (`from` = first tick hour); returns the campaign sends of that day. */
  const day = async (d: number, from = 9) => {
    for (let h = from; h <= 15; h += 2) {
      t = START.getTime() + d * DAY + (h - 9) * HOUR;
      await tick();
    }
    return sentOn(d);
  };
  const at = (d: number, h = 9) => {
    t = START.getTime() + d * DAY + (h - 9) * HOUR;
  };
  const acct = () => P.emailAccount.findUniqueOrThrow({ where: { id: A.id } });
  /** Hard-bounce DSNs for the first `k` sends, delivered to the mailbox (ingested by the next sync). */
  const bounce = async (k: number) => {
    const rows = await P.scheduledMessage.findMany({
      where: { accountId: A.id, status: "SENT" },
      include: { campaignLead: { include: { lead: true } } },
      orderBy: { sentAt: "asc" },
      take: k,
    });
    for (const r of rows)
      await fake(A).receiveRaw(
        dsn(A.email, r.campaignLead.lead.email, r.rfcMessageId!, clock.now()),
      );
  };
  return { s, A, clock, day, at, tick, acct, bounce };
}

describe("PS-REWARM-13 scenarios on the Fake", () => {
  test("(1) inactive 30 d, AUTO: day 1 sends 5, day 2 7, day 3 9", async () => {
    const w = await world(db.prisma, { idle: 30, autoRewarm: "AUTO" });
    expect([await w.day(0), await w.day(1), await w.day(2)]).toEqual([5, 7, 9]);
    expect(await w.acct()).toMatchObject({ lifecycle: "REWARMING", rewarmSendDays: 3 });
  }, 120_000);

  test("(2) inactive 60 d, RECOMMEND: nothing until the user starts a re-warm, then the same ramp", async () => {
    const P = db.prisma;
    const w = await world(P, { idle: 60, autoRewarm: "RECOMMEND" });
    expect(await w.day(0)).toBe(0);
    expect((await w.acct()).lifecycle).toBe("INACTIVE");
    w.at(1);
    const { warnings } = await startRewarm(
      P,
      w.clock,
      { providerFor: syncDeps.providerFor, resolver },
      w.s.ws,
      "u1",
      w.A.id,
      {},
    );
    expect(warnings.every((x) => x.level === "warn")).toBe(true);
    expect([await w.day(1), await w.day(2), await w.day(3)]).toEqual([5, 7, 9]);
  }, 120_000);

  test("(3) OAuth expiry: NEEDS_ATTENTION, reconnected 35 days later on the same row → REWARMING at 5", async () => {
    const P = db.prisma;
    const w = await world(P, { idle: 1, autoRewarm: "AUTO" });
    fake(w.A).failNextRead("auth_revoked");
    w.at(0);
    await w.tick();
    expect(await w.acct()).toMatchObject({ lifecycle: "NEEDS_ATTENTION" });
    expect(await w.day(0, 11)).toBe(0);
    w.at(35);
    const server = {
      host: "mail.send.test",
      port: 993,
      secure: true,
      username: "u",
      password: "p",
    };
    await reconnectSmtpAccount(P, w.clock, { providerFor: () => fake(w.A) }, w.s.ws, "u1", w.A.id, {
      imap: server,
      smtp: { ...server, port: 465 },
    });
    expect(await w.day(35)).toBe(5);
    expect(await w.acct()).toMatchObject({
      id: w.A.id,
      lifecycle: "REWARMING",
      rewarmStartedAt: new Date(START.getTime() + 35 * DAY),
    });
    expect(await P.emailAccount.count()).toBe(1);
  }, 120_000);

  test("(4a) bounce breach below 50 sends: health cap, the ramp step is held, not paused (Rev 2 I4)", async () => {
    const w = await world(db.prisma, { idle: 30, autoRewarm: "AUTO" });
    expect([await w.day(0), await w.day(1), await w.day(2)]).toEqual([5, 7, 9]);
    await w.bounce(2); // 2 of 21
    w.at(2, 16);
    await w.tick();
    const a = await w.acct();
    expect(a).toMatchObject({ lifecycle: "REWARMING", healthCap: 4, rewarmSendDays: 3 });
    expect(await w.day(3)).toBeLessThanOrEqual(4);
    expect(await w.acct()).toMatchObject({ lifecycle: "REWARMING", rewarmSendDays: 3 });
  }, 120_000);

  test("(4b) bounce breach over 50 accepted: PAUSED; resume → REWARMING at the same step, not re-paused", async () => {
    const P = db.prisma;
    const w = await world(P, { idle: 30, autoRewarm: "AUTO" });
    expect([await w.day(0), await w.day(1), await w.day(2)]).toEqual([5, 7, 9]);
    // seeded history: 21 real + 29 earlier accepted sends = 50; 2 hard bounces = 4 % > 3 %
    await P.event.createMany({
      data: Array.from({ length: 29 }, () => ({
        workspaceId: w.s.ws,
        accountId: w.A.id,
        type: "ACCEPTED" as const,
        occurredAt: new Date(START.getTime() + 2 * DAY),
        meta: {},
        dedupeKey: `seed:${randomBytes(8).toString("hex")}`,
      })),
    });
    await w.bounce(2);
    w.at(2, 16);
    await w.tick();
    expect(await w.acct()).toMatchObject({
      lifecycle: "PAUSED",
      lastError: { kind: "SOFT_BOUNCE", code: "bounce_rate" },
      rewarmSendDays: 3,
    });
    expect(await w.day(3, 9)).toBe(0);
    expect((await w.acct()).rewarmSendDays).toBe(3);
    w.at(3, 16);
    await resumeAccount(P, w.s.ws, w.A.id, { clock: w.clock, actorId: "u1" });
    await w.tick(); // evaluateHealth: the same bounces never pause it again (I3)
    const a = await w.acct();
    expect(a).toMatchObject({ lifecycle: "REWARMING", rewarmSendDays: 3 });
    expect(rewarmPlanView(a, w.clock.now())!.allowance).toBe(11); // the same step, not more
    expect(effectiveAllowance(a, w.clock.now())).toBeLessThanOrEqual(11);
  }, 120_000);

  test.each(["provider_errors", "dns_block"] as const)(
    "(4c) %s during re-warm: health cap and the ramp step is held (Rev 2 I11)",
    async (why) => {
      const P = db.prisma;
      const w = await world(P, { idle: 30, autoRewarm: "AUTO" });
      expect([await w.day(0), await w.day(1)]).toEqual([5, 7]);
      w.at(1, 16);
      if (why === "provider_errors")
        await P.event.createMany({
          data: Array.from({ length: 5 }, () => ({
            workspaceId: w.s.ws,
            accountId: w.A.id,
            type: "SEND_FAILED" as const,
            occurredAt: w.clock.now(),
            meta: { error: "x", scope: "account" },
            dedupeKey: `pe:${randomBytes(8).toString("hex")}`,
          })),
        });
      else
        await P.domainCheck.create({
          data: {
            workspaceId: w.s.ws,
            domain: "send.test",
            level: "block",
            report: {},
            checkedAt: w.clock.now(),
          },
        });
      await w.tick();
      expect((await w.acct()).healthCap).toBe(3); // floor(7 x 50 %)
      expect(await w.day(2)).toBeLessThanOrEqual(3);
      expect((await w.acct()).rewarmSendDays).toBe(2);
    },
    120_000,
  );

  test("(5) return to normal + PS-REWARM-14: target reached and clean days → ACTIVE at dailyLimit, nothing lost", async () => {
    const P = db.prisma;
    const rowsAt = new Date(START.getTime() - 31 * DAY);
    const w = await world(P, {
      idle: 32,
      autoRewarm: "RECOMMEND",
      rowsAt,
      account: {
        dailyLimit: 11,
        minGapSec: 0,
        randomGapSec: 0,
        signature: "-- S",
        tags: ["eu", "main"],
      },
    });
    // history: a normal day 31 days before day 0
    expect(await w.day(-31)).toBe(11);
    const snap = async () => {
      const a = await w.acct();
      return {
        account: [a.id, a.dailyLimit, a.minGapSec, a.randomGapSec, a.signature, a.tags],
        messages: (await P.message.findMany({ select: { id: true } })).map((x) => x.id).sort(),
        events: (await P.event.findMany({ select: { id: true } })).map((x) => x.id).sort(),
        usage: await P.accountDailyUsage.findMany({
          where: { day: { lt: START } },
          orderBy: { day: "asc" },
        }),
        campaigns: await P.campaignAccount.findMany({ where: { accountId: a.id } }),
      };
    };
    const before = await snap();
    expect(before.messages.length).toBeGreaterThan(0);

    expect(await w.day(0)).toBe(0); // INACTIVE (RECOMMEND)
    w.at(0, 15);
    await startRewarm(
      P,
      w.clock,
      { providerFor: syncDeps.providerFor, resolver },
      w.s.ws,
      "u1",
      w.A.id,
      {
        withWarmup: true,
      },
    );
    expect(
      (await P.warmupSettings.findUniqueOrThrow({ where: { accountId: w.A.id } })).enabled,
    ).toBe(true);
    expect(await w.day(0, 15)).toBe(5);
    expect(await w.day(1)).toBe(7);
    // a transient error recorded on day 1: the exit criteria wait 3 clean days after it
    await P.emailAccount.update({
      where: { id: w.A.id },
      data: { lastErrorAt: new Date(START.getTime() + DAY) },
    });
    expect(await w.day(2)).toBe(9);
    expect(await w.day(3)).toBe(11); // the target: allowance reached
    expect((await w.acct()).lifecycle).toBe("REWARMING"); // the error is only 2 days old
    await w.day(4);
    const a = await w.acct();
    expect(a).toMatchObject({ lifecycle: "ACTIVE", rewarmStartedAt: null, rewarmPrevious: null });
    expect(effectiveAllowance(a, w.clock.now())).toBe(11);
    expect(
      (await P.warmupSettings.findUniqueOrThrow({ where: { accountId: w.A.id } })).enabled,
    ).toBe(false);
    expect(
      await P.auditLog.count({ where: { action: "account.rewarm_complete", target: w.A.id } }),
    ).toBe(1);

    // PS-REWARM-14: same row and settings; every earlier message, event and usage row and every assignment kept
    const after = await snap();
    expect(after.account).toEqual(before.account);
    expect(after.messages).toEqual(expect.arrayContaining(before.messages));
    expect(after.events).toEqual(expect.arrayContaining(before.events));
    expect(after.usage).toEqual(before.usage);
    expect(after.campaigns).toEqual(before.campaigns);
  }, 180_000);
});
