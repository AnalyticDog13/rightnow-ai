import { createPrisma } from "@rightnow/db/create";
import type { AccountProvider, Prisma, PrismaClient } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fixedClock } from "../src/clock";
import { claimDue, sendableProviders, withTxRetry, type ClaimOpts } from "../src/dispatch";
import { commitUsage, effectiveAllowance } from "../src/quota";
import { hashValue } from "../src/leads/suppression";
import { markFresh, planRow, seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const extra: PrismaClient[] = [];
const client = () => {
  const p = createPrisma(db.url, 5);
  extra.push(p);
  return p;
};
const P = () => db.prisma;
const ALL: AccountProvider[] = ["GMAIL", "MICROSOFT", "SMTP"];
const T = new Date("2026-10-20T10:00:00Z"); // Tuesday
const opts = (o: Partial<ClaimOpts> = {}): ClaimOpts => ({
  limit: 5,
  bootId: "boot-1",
  stalenessSec: 300,
  sendableProviders: ALL,
  ...o,
});
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const row = (id: string) => P().scheduledMessage.findUniqueOrThrow({ where: { id } });
const usage = (accountId: string) =>
  P().accountDailyUsage.findMany({ where: { accountId }, orderBy: { day: "asc" } });

beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await Promise.all(extra.splice(0).map((p) => p.$disconnect()));
  await db.drop();
});

/** Loops claimDue({limit:1}) on its own client until nothing is claimable. */
async function drain(p: PrismaClient, clock = fixedClock(T)) {
  const out = [];
  for (;;) {
    const r = await claimDue(p, clock, opts({ limit: 1 }));
    if (!r.length) return out;
    out.push(...r);
  }
}

describe("claimDue: quota", () => {
  test("parallel claim: 2 dispatchers × 2 accounts, no deadlock, no over-quota", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 20 });
    const [a, b] = s.accounts.map((x) => x.id) as [string, string];
    // the first 10 due rows are A's and the last 10 B's, so both dispatchers contend for the same account
    for (const [i, r] of s.rows.entries())
      await P().scheduledMessage.update({
        where: { id: r.id },
        data: { accountId: i < 10 ? a : b },
      });
    const [r1, r2] = await Promise.all([drain(client()), drain(client())]);
    const all = [...r1, ...r2];
    expect(all).toHaveLength(10);
    expect(all.filter((c) => c.accountId === a)).toHaveLength(5);
    expect(all.filter((c) => c.accountId === b)).toHaveLength(5);
    expect(new Set(all.map((c) => c.id)).size).toBe(10);
    expect(new Set(all.map((c) => c.claimToken)).size).toBe(10);
    expect((await usage(a)).map((u) => [u.sent, u.reserved])).toEqual([[0, 5]]);
    expect((await usage(b)).map((u) => [u.sent, u.reserved])).toEqual([[0, 5]]);
    expect(await P().scheduledMessage.count({ where: { status: "SENDING" } })).toBe(10);
    // the other 10 wait for the next day's window, untouched otherwise
    const rest = await P().scheduledMessage.findMany({ where: { status: "SCHEDULED" } });
    expect(rest.map((r) => r.dueAt.toISOString())).toEqual(
      Array(10).fill("2026-10-21T00:00:00.000Z"),
    );
  });

  test("account at 49/50, two workers → exactly one more", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      rows: 2,
      accounts: [{ dailyLimit: 50, providerCap: 100 }],
    });
    const a = s.accounts[0]!.id;
    await P().accountDailyUsage.create({
      data: { accountId: a, day: day("2026-10-20"), sent: 49 },
    });
    const clock = fixedClock(T);
    await Promise.all([client(), client()].map((p) => claimDue(p, clock, opts({ limit: 1 }))));
    const rows = await P().scheduledMessage.findMany({ orderBy: { status: "asc" } });
    expect(rows.map((r) => r.status).sort()).toEqual(["SCHEDULED", "SENDING"]);
    expect(rows.find((r) => r.status === "SCHEDULED")!.dueAt).toEqual(day("2026-10-21"));
    expect((await usage(a)).map((u) => [u.sent, u.reserved])).toEqual([[49, 1]]);
  });

  test("deterministic interleaving: two claims queue on the usage row lock, exactly one wins", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 2, accounts: [{ dailyLimit: 50 }] });
    const a = s.accounts[0]!.id;
    await P().accountDailyUsage.create({
      data: { accountId: a, day: day("2026-10-20"), sent: 49 },
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const held = new Promise<void>((r) => (locked = r));
    const holder = client().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT * FROM "AccountDailyUsage" WHERE "accountId" = ${a} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 60_000 },
    );
    await held;
    const clock = fixedClock(T);
    const claims = [client(), client()].map((p) => claimDue(p, clock, opts({ limit: 1 })));
    for (let i = 0; ; i++) {
      const [w] = await P().$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (w!.n >= 2) break;
      if (i > 200) throw new Error("claims never queued on the lock");
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await holder;
    const claimed = (await Promise.all(claims)).flat();
    expect(claimed).toHaveLength(1);
    expect((await usage(a)).map((u) => [u.sent, u.reserved])).toEqual([[49, 1]]);
  });

  test("claim at 23:59:59, completes at 00:00:01, credited to the claim day", async () => {
    const at = new Date("2026-10-20T23:59:59Z");
    const clock = fixedClock(at);
    const s = await seedCampaign(P(), { at, rows: 1, accounts: [{}] });
    const a = s.accounts[0]!.id;
    const [c] = await claimDue(P(), clock, opts());
    expect(c).toMatchObject({
      usageDay: "2026-10-20",
      campUsageDay: "2026-10-20",
      wsUsageDay: "2026-10-20",
    });
    clock.advance(2000);
    await commitUsage(P(), c!);
    expect(
      (await usage(a)).map((u) => [u.day.toISOString().slice(0, 10), u.sent, u.reserved]),
    ).toEqual([["2026-10-20", 1, 0]]);
    const camp = await P().campaignDailyUsage.findMany({ where: { campaignId: s.campaign.id } });
    expect(camp.map((u) => [u.day.toISOString().slice(0, 10), u.sent, u.reserved])).toEqual([
      ["2026-10-20", 1, 0],
    ]);
    const w = await P().workspaceDailyUsage.findMany({ where: { workspaceId: s.ws } });
    expect(w.map((u) => [u.day.toISOString().slice(0, 10), u.sent, u.reserved])).toEqual([
      ["2026-10-20", 1, 0],
    ]);

    const nz = await seedCampaign(P(), {
      at,
      rows: 1,
      accounts: [{ timezone: "Pacific/Auckland" }],
    });
    const [c2] = await claimDue(P(), fixedClock(at), opts());
    expect(c2).toMatchObject({
      accountId: nz.accounts[0]!.id,
      usageDay: "2026-10-21",
      campUsageDay: "2026-10-20",
    });
  });

  test("campaign cap", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 5, campaign: { dailyLimit: 3 } });
    expect(await claimDue(P(), fixedClock(T), opts())).toHaveLength(3);
    const rest = await P().scheduledMessage.findMany({ where: { status: "SCHEDULED" } });
    expect(rest.map((r) => r.dueAt)).toEqual([day("2026-10-21"), day("2026-10-21")]);
    const cu = await P().campaignDailyUsage.findFirstOrThrow({
      where: { campaignId: s.campaign.id },
    });
    expect([cu.sent, cu.reserved]).toEqual([0, 3]);
  });

  test("workspace cap", async () => {
    const one = await seedCampaign(P(), { at: T, rows: 2, workspace: { dailyCap: 2 } });
    const two = await seedCampaign(P(), { at: T, rows: 2, workspaceId: one.ws });
    expect(await claimDue(P(), fixedClock(T), opts({ limit: 10 }))).toHaveLength(2);
    const w = await P().workspaceDailyUsage.findFirstOrThrow({ where: { workspaceId: one.ws } });
    expect(w.reserved).toBe(2);
    // no partial reservation for the refused rows: account and campaign totals equal the claims
    const acc = await P().accountDailyUsage.aggregate({ _sum: { reserved: true } });
    const camp = await P().campaignDailyUsage.aggregate({
      _sum: { reserved: true },
      where: { campaignId: { in: [one.campaign.id, two.campaign.id] } },
    });
    expect([acc._sum.reserved, camp._sum.reserved]).toEqual([2, 2]);
  });

  test("reservation rollback: campaign full, account has room → account usage and nextSendAt untouched", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      rows: 1,
      accounts: [{ nextSendAt: new Date("2026-10-20T09:00:00Z") }],
      campaign: { dailyLimit: 1, minGapSec: 60 },
    });
    const a = s.accounts[0]!.id;
    await P().accountDailyUsage.create({ data: { accountId: a, day: day("2026-10-20"), sent: 1 } });
    await P().campaignDailyUsage.create({
      data: { campaignId: s.campaign.id, day: day("2026-10-20"), sent: 1 },
    });
    const before = await usage(a);
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await usage(a)).toEqual(before);
    expect((await P().emailAccount.findUniqueOrThrow({ where: { id: a } })).nextSendAt).toEqual(
      new Date("2026-10-20T09:00:00Z"),
    );
    expect(await P().workspaceDailyUsage.count()).toBe(0);
    expect(await row(s.rows[0]!.id)).toMatchObject({
      status: "SCHEDULED",
      dueAt: day("2026-10-21"),
    });
  });

  test("first claim of the day with allowance 0, units > allowance; cc/bcc count", async () => {
    await seedCampaign(P(), { at: T, rows: 1, accounts: [{ dailyLimit: 0 }] });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await P().accountDailyUsage.count()).toBe(0);

    const db2 = await seedCampaign(P(), {
      at: T,
      rows: 1,
      accounts: [{ dailyLimit: 2 }],
      campaign: { cc: ["c@x.test"], bcc: ["b@x.test"] },
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await P().accountDailyUsage.count()).toBe(0);

    await P().emailAccount.update({ where: { id: db2.accounts[0]!.id }, data: { dailyLimit: 5 } });
    await P().scheduledMessage.update({ where: { id: db2.rows[0]!.id }, data: { dueAt: T } });
    const [c] = await claimDue(P(), fixedClock(T), opts());
    expect(c!.reservedUnits).toBe(3);
    expect((await row(c!.id)).reservedUnits).toBe(3);
    expect((await usage(db2.accounts[0]!.id))[0]!.reserved).toBe(3);
  });

  test("cc/bcc stored at claim (M8)", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 1, campaign: { cc: ["c@x.test"] } });
    const [c] = await claimDue(P(), fixedClock(T), opts());
    await P().campaign.update({
      where: { id: s.campaign.id },
      data: { cc: ["1@x.test", "2@x.test", "3@x.test"] },
    });
    expect(await row(c!.id)).toMatchObject({ cc: ["c@x.test"], bcc: [], reservedUnits: 2 });
  });

  test("gap: nextSendAt = now + max(min gaps) + floor(random · (max(random gaps)+1)); the next row waits", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      rows: 2,
      accounts: [{ minGapSec: 0 }],
      campaign: { minGapSec: 540, randomGapSec: 300 },
    });
    const got = await claimDue(P(), fixedClock(T), opts({ random: () => 0.5 }));
    expect(got).toHaveLength(1);
    const a = await P().emailAccount.findUniqueOrThrow({ where: { id: s.accounts[0]!.id } });
    expect(a.nextSendAt).toEqual(new Date(T.getTime() + (540 + 150) * 1000));
    expect(await P().scheduledMessage.count({ where: { status: "SCHEDULED", dueAt: T } })).toBe(1);
  });
});

describe("claimDue: gates", () => {
  test("claimed row: SENDING with claimToken, lease fields, usage days and an rfcMessageId; one message per transaction", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 3 });
    await P().scheduledMessage.update({
      where: { id: s.rows[2]!.id },
      data: { rfcMessageId: "<kept@x>" },
    });
    const tx = vi.spyOn(P(), "$transaction");
    const got = await claimDue(P(), fixedClock(T), opts({ limit: 3 }));
    expect(got).toHaveLength(3);
    expect(tx.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const c of got) {
      const r = await row(c.id);
      expect(r).toMatchObject({
        status: "SENDING",
        claimToken: c.claimToken,
        claimedAt: T,
        claimBootId: "boot-1",
        rfcMessageId: c.rfcMessageId,
        reservedUnits: 1,
        usageDay: day("2026-10-20"),
        campUsageDay: day("2026-10-20"),
        wsUsageDay: day("2026-10-20"),
      });
      expect(c.claimToken).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(got.find((c) => c.id === s.rows[2]!.id)!.rfcMessageId).toBe("<kept@x>");
    expect(got.find((c) => c.id === s.rows[0]!.id)!.rfcMessageId).toMatch(
      /^<[0-9a-f-]+@send\.test>$/,
    );
  });

  test("paused campaign / past endAt → not claimed", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 1, campaign: { status: "PAUSED" } });
    const before = await row(s.rows[0]!.id);
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await row(s.rows[0]!.id)).toEqual(before);
    const c = { id: s.campaign.id };
    await P().campaign.update({
      where: c,
      data: { status: "ACTIVE", endAt: new Date(T.getTime() - 1000) },
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    await P().campaign.update({
      where: c,
      data: { endAt: null, startAt: new Date(T.getTime() + 1000) },
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    await P().campaign.update({ where: c, data: { startAt: null, deletedAt: T } });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    await P().campaign.update({ where: c, data: { deletedAt: null } });
    expect(await claimDue(P(), fixedClock(T), opts())).toHaveLength(1);
  });

  test("overdue row at 03:00 → not sent until window opens", async () => {
    const now = new Date("2026-10-21T01:00:00Z"); // 03:00 in Berlin (CEST)
    const s = await seedCampaign(P(), {
      at: now,
      rows: 1,
      schedules: [{ timezone: "Europe/Berlin", days: 127, from: "09:00", to: "17:00" }],
    });
    await P().scheduledMessage.update({
      where: { id: s.rows[0]!.id },
      data: { dueAt: new Date("2026-10-20T08:00:00Z") },
    });
    const clock = fixedClock(now);
    expect(await claimDue(P(), clock, opts())).toEqual([]);
    expect((await row(s.rows[0]!.id)).dueAt).toEqual(new Date("2026-10-21T07:00:00Z"));
    clock.advance(6 * 3600_000);
    await markFresh(
      P(),
      s.accounts.map((a) => a.id),
      clock.now(),
    );
    expect(await claimDue(P(), clock, opts())).toHaveLength(1);
  });

  test("freshness gate", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 6, accounts: [{}, {}] });
    const [A, B] = s.accounts.map((a) => a.id) as [string, string];
    let i = 0;
    const plan = () =>
      planRow(P(), {
        workspaceId: s.ws,
        campaignId: s.campaign.id,
        campaignLeadId: s.leads[i++]!.cl.id,
        stepId: s.steps[0]!.id,
        variantId: s.steps[0]!.variant.id,
        accountId: A,
        dueAt: T,
      });
    const fresh = (id: string, sec: number | null) =>
      P().emailAccount.update({
        where: { id },
        data: { lastSyncCompletedAt: sec === null ? null : new Date(T.getTime() - sec * 1000) },
      });
    const claim = () => claimDue(P(), fixedClock(T), opts());
    await plan();
    await fresh(A, 301);
    expect(await claim()).toEqual([]);
    await fresh(A, null);
    expect(await claim()).toEqual([]);
    await fresh(A, 299);
    expect(await claim()).toHaveLength(1);

    await P().campaign.update({
      where: { id: s.campaign.id },
      data: { stopForCompanyOnReply: true },
    });
    await plan();
    await fresh(B, 301);
    expect(await claim()).toEqual([]);
    await P().emailAccount.update({ where: { id: B }, data: { deletedAt: T } });
    expect(await claim()).toHaveLength(1);
    await P().emailAccount.update({ where: { id: B }, data: { deletedAt: null } });
    await plan();
    expect(await claim()).toEqual([]);
    await P().campaignAccount.delete({
      where: { campaignId_accountId: { campaignId: s.campaign.id, accountId: B } },
    });
    expect(await claim()).toHaveLength(1);
    await P().campaignAccount.create({ data: { campaignId: s.campaign.id, accountId: B } });
    await fresh(B, 0);
    await P().emailAccount.update({ where: { id: B }, data: { lifecycle: "NEEDS_ATTENTION" } });
    await plan();
    expect(await claim()).toEqual([]);
    await P().emailAccount.update({ where: { id: B }, data: { lifecycle: "ACTIVE" } });
    expect(await claim()).toHaveLength(1);
  });

  test("sticky gate: a follow-up waits for its paused account (PS-ACC-27)", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 1, steps: 2 });
    const [A] = s.accounts.map((a) => a.id) as [string];
    const cl = s.leads[0]!.cl;
    await P().campaignLead.update({
      where: { id: cl.id },
      data: { currentStepId: s.steps[1]!.id, accountId: A },
    });
    const r = await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: cl.id,
      stepId: s.steps[1]!.id,
      variantId: s.steps[1]!.variant.id,
      accountId: A,
      dueAt: T,
    });
    await P().emailAccount.update({ where: { id: A }, data: { lifecycle: "PAUSED" } });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await row(r.id)).toMatchObject({ status: "SCHEDULED", accountId: A });
  });

  test("M-6: a step-1 row whose account no longer matches the campaign's tags is cancelled stale; a follow-up stays sticky", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      rows: 1,
      leads: 2,
      steps: 2,
      accounts: [{ tags: ["red"] }],
      campaign: { accountTags: ["red"] },
    });
    const [A] = s.accounts.map((a) => a.id) as [string];
    const cl2 = s.leads[1]!.cl;
    await P().campaignLead.update({
      where: { id: cl2.id },
      data: { currentStepId: s.steps[1]!.id, accountId: A },
    });
    const follow = await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: cl2.id,
      stepId: s.steps[1]!.id,
      variantId: s.steps[1]!.variant.id,
      accountId: A,
      dueAt: T,
    });
    await P().campaign.update({ where: { id: s.campaign.id }, data: { accountTags: ["blue"] } });
    const got = await claimDue(P(), fixedClock(T), opts());
    expect(got.map((c) => c.id)).toEqual([follow.id]);
    expect(await row(s.rows[0]!.id)).toMatchObject({ status: "CANCELLED", error: "stale" });
    expect((await usage(A)).map((u) => [u.sent, u.reserved])).toEqual([[0, 1]]);

    // ESP routing works the same way: a do_not_send rule for this sender blocks a step-1 row
    const s2 = await seedCampaign(P(), {
      at: T,
      rows: 1,
      campaign: {
        espRoutingRules: [{ action: "do_not_send", senderEsp: "other", recipientEsp: "all" }],
      },
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await row(s2.rows[0]!.id)).toMatchObject({ status: "CANCELLED", error: "stale" });
  });

  test("row for a step that is not current is not claimed (C2); QUEUED claims only main step 1", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 2, steps: 2 });
    const sub = await P().subsequence.create({
      data: { campaignId: s.campaign.id, name: "s", trigger: {} },
    });
    const subStep = await P().sequenceStep.create({
      data: { campaignId: s.campaign.id, subsequenceId: sub.id, order: 1, delayValue: 0 },
    });
    const cl = s.leads[0]!.cl;
    await P().campaignLead.update({
      where: { id: cl.id },
      data: { subsequenceId: sub.id, currentStepId: subStep.id },
    });
    const r = await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: cl.id,
      stepId: s.steps[1]!.id,
      variantId: s.steps[1]!.variant.id,
      accountId: s.accounts[0]!.id,
      dueAt: T,
    });
    const before = await row(r.id);
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await row(r.id)).toEqual(before);

    // a QUEUED lead: its main step-1 row is claimable, a step-2 row is not
    const q = s.leads[1]!.cl;
    await P().campaignLead.update({
      where: { id: q.id },
      data: { state: "QUEUED", currentStepId: s.steps[1]!.id },
    });
    const r2 = await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: q.id,
      stepId: s.steps[1]!.id,
      variantId: s.steps[1]!.variant.id,
      accountId: s.accounts[0]!.id,
      dueAt: T,
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    await P().scheduledMessage.delete({ where: { id: r2.id } });
    await P().campaignLead.update({ where: { id: q.id }, data: { currentStepId: s.steps[0]!.id } });
    await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: q.id,
      stepId: s.steps[0]!.id,
      variantId: s.steps[0]!.variant.id,
      accountId: s.accounts[0]!.id,
      dueAt: T,
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toHaveLength(1);
  });

  test("suppression re-check: DOMAIN and EMAIL entries cancel the row at claim and stop the lead", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 2 });
    const [l0, l1] = s.leads;
    // written straight to the table, as if the suppress() hook had skipped the row a claim was holding
    await P().suppression.createMany({
      data: [
        {
          workspaceId: s.ws,
          kind: "DOMAIN",
          valueHash: hashValue(l0!.lead.email.split("@")[1]!),
          reason: "MANUAL",
        },
        {
          workspaceId: s.ws,
          kind: "EMAIL",
          valueHash: hashValue(l1!.lead.email),
          reason: "MANUAL",
        },
      ],
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    for (const [i, l] of [l0!, l1!].entries()) {
      expect(await row(s.rows[i]!.id)).toMatchObject({ status: "CANCELLED", error: "suppressed" });
      expect(await P().campaignLead.findUniqueOrThrow({ where: { id: l.cl.id } })).toMatchObject({
        state: "STOPPED",
        stopReason: "SUPPRESSED",
      });
    }
    expect(await P().accountDailyUsage.count()).toBe(0);
  });

  test("lead, step and variant re-checks: a deleted or invalid lead, a deleted step or an inactive variant cancels the row", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 4 });
    await P().lead.update({ where: { id: s.leads[0]!.lead.id }, data: { deletedAt: T } });
    await P().lead.update({
      where: { id: s.leads[1]!.lead.id },
      data: { verificationStatus: "INVALID" },
    });
    expect(await claimDue(P(), fixedClock(T), opts({ limit: 2 }))).toHaveLength(2);
    for (const r of s.rows.slice(0, 2))
      expect(await row(r.id)).toMatchObject({ status: "CANCELLED", error: "suppressed" });

    const t = await seedCampaign(P(), { at: T, rows: 1 });
    await P().stepVariant.update({
      where: { id: t.steps[0]!.variant.id },
      data: { active: false },
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await row(t.rows[0]!.id)).toMatchObject({ status: "CANCELLED", error: "stale" });
    const u = await seedCampaign(P(), { at: T, rows: 1 });
    await P().sequenceStep.update({ where: { id: u.steps[0]!.id }, data: { deletedAt: T } });
    expect(await claimDue(P(), fixedClock(T), opts())).toEqual([]);
    expect(await row(u.rows[0]!.id)).toMatchObject({ status: "CANCELLED", error: "stale" });
    // a stale row never touches the lead
    for (const x of [t, u])
      expect(
        (await P().campaignLead.findUniqueOrThrow({ where: { id: x.leads[0]!.cl.id } })).state,
      ).toBe("ACTIVE");
  });

  /** Runs claimDue while `hold` keeps a row lock open in another transaction; returns the claim result. */
  async function claimWhileLocked(
    hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
    waiters: number,
    claims = 1,
  ) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const held = new Promise<void>((r) => (locked = r));
    const holder = client().$transaction(
      async (tx) => {
        await hold(tx);
        locked();
        await gate;
      },
      { timeout: 60_000 },
    );
    await held;
    const clock = fixedClock(T);
    const running = Array.from({ length: claims }, () =>
      claimDue(client(), clock, opts({ limit: 1 })),
    );
    for (let i = 0; ; i++) {
      const [w] = await P().$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (w!.n >= waiters) break;
      if (i > 200) throw new Error("claims never waited on the lock");
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await holder;
    return (await Promise.all(running)).flat();
  }

  test("claim re-checks the CampaignLead under its row lock (T06 I1)", async () => {
    // a concurrent pause, then a concurrent step move, commit while the claim already holds the message
    const s = await seedCampaign(P(), { at: T, rows: 1, leads: 2, steps: 2 });
    const [a, b] = s.leads.map((l) => l.cl.id) as [string, string];
    const paused = await claimWhileLocked(
      (tx) => tx.campaignLead.update({ where: { id: a }, data: { state: "PAUSED" } }),
      1,
    );
    expect(paused).toEqual([]);
    expect(await row(s.rows[0]!.id)).toMatchObject({ status: "CANCELLED", error: "stale" });
    const r1 = await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: b,
      stepId: s.steps[0]!.id,
      variantId: s.steps[0]!.variant.id,
      accountId: s.accounts[0]!.id,
      dueAt: T,
    });
    const moved = await claimWhileLocked(
      (tx) => tx.campaignLead.update({ where: { id: b }, data: { currentStepId: s.steps[1]!.id } }),
      1,
    );
    expect(moved).toEqual([]);
    expect(await row(r1.id)).toMatchObject({ status: "CANCELLED", error: "stale" });
    expect(await P().accountDailyUsage.count()).toBe(0);
  });

  test("gap race: two claims on one account, the loser waits for nextSendAt", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      rows: 2,
      accounts: [{ dailyLimit: 50 }],
      campaign: { minGapSec: 540, randomGapSec: 0 },
    });
    const a = s.accounts[0]!.id;
    await P().accountDailyUsage.create({ data: { accountId: a, day: day("2026-10-20") } });
    // both claims pass the SELECT, then queue on the usage row; only the gap guard can stop the second
    const got = await claimWhileLocked(
      (tx) => tx.$queryRaw`SELECT 1 FROM "AccountDailyUsage" WHERE "accountId" = ${a} FOR UPDATE`,
      2,
      2,
    );
    expect(got).toHaveLength(1);
    const next = new Date(T.getTime() + 540_000);
    expect((await P().emailAccount.findUniqueOrThrow({ where: { id: a } })).nextSendAt).toEqual(
      next,
    );
    const loser = await P().scheduledMessage.findFirstOrThrow({ where: { status: "SCHEDULED" } });
    expect(loser.dueAt).toEqual(next);
    expect((await usage(a)).map((u) => u.reserved)).toEqual([1]);
  });

  test("provider gate (D17) and physical address", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      rows: 1,
      accounts: [{ provider: "GMAIL", capTier: "GMAIL_WORKSPACE" }],
    });
    expect(await sendableProviders(P(), {})).toEqual([]);
    expect(await sendableProviders(P(), { MAIL_PROVIDER_FAKE: "1" })).toEqual(ALL);
    const gated = async () =>
      claimDue(P(), fixedClock(T), opts({ sendableProviders: await sendableProviders(P(), {}) }));
    expect(await gated()).toEqual([]);
    await P().providerVerification.create({
      data: { provider: "GMAIL", passedAt: T, accountId: s.accounts[0]!.id, report: {} },
    });
    expect(await sendableProviders(P(), {})).toEqual(["GMAIL"]);
    await P().workspace.update({ where: { id: s.ws }, data: { physicalAddress: "  " } });
    expect(await gated()).toEqual([]);
    await P().workspace.update({ where: { id: s.ws }, data: { physicalAddress: null } });
    expect(await gated()).toEqual([]);
    await P().workspace.update({ where: { id: s.ws }, data: { physicalAddress: "1 Main St" } });
    expect(await gated()).toHaveLength(1);
  });

  test("one broken row does not block the others (I5)", async () => {
    const w1 = await seedCampaign(P(), { at: T, rows: 1 });
    const w2 = await seedCampaign(P(), { at: T, rows: 1 });
    await P().scheduledMessage.update({
      where: { id: w1.rows[0]!.id },
      data: { dueAt: new Date(T.getTime() - 60_000) },
    });
    await P()
      .$executeRaw`UPDATE "CampaignSchedule" SET days = 0 WHERE "campaignId" = ${w1.campaign.id}`;
    const clock = fixedClock(T);
    const got = await claimDue(P(), clock, opts());
    expect(got.map((c) => c.id)).toEqual([w2.rows[0]!.id]);
    const r = await row(w1.rows[0]!.id);
    expect(r).toMatchObject({ status: "SCHEDULED", claimErrors: 1, attempts: 0 });
    expect(r.error).toMatch(/^claim_error: /);
    expect(r.dueAt).toEqual(new Date(T.getTime() + 3600_000));
    for (let i = 0; i < 4; i++) {
      clock.advance(3600_000);
      await markFresh(
        P(),
        w1.accounts.map((a) => a.id),
        clock.now(),
      );
      await claimDue(P(), clock, opts());
    }
    expect(await row(w1.rows[0]!.id)).toMatchObject({ status: "FAILED", claimErrors: 5 });
    expect(
      await P().campaignLead.findUniqueOrThrow({ where: { id: w1.leads[0]!.cl.id } }),
    ).toMatchObject({
      state: "PAUSED",
      stopReason: "SEND_FAILED",
    });
    // M4: the failed claim counts as a provider error of unknown scope, dated by the injected clock
    expect(
      await P().event.findMany({ where: { scheduledMessageId: w1.rows[0]!.id } }),
    ).toMatchObject([
      {
        type: "SEND_FAILED",
        occurredAt: clock.now(),
        accountId: w1.accounts[0]!.id,
        meta: { scope: "unknown" },
      },
    ]);
  });

  test("a pause that commits while the claim waits on the CampaignLead lock wins (no SENDING, no reservation)", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 1 });
    const id = s.rows[0]!.id;
    const cl = s.leads[0]!.cl.id;
    const touch = (tx: Prisma.TransactionClient) =>
      tx.campaignLead.update({ where: { id: cl }, data: { nextDueAt: T } });
    const paused = await claimWhileLocked(async (tx) => {
      await touch(tx);
      await tx.campaign.update({ where: { id: s.campaign.id }, data: { status: "PAUSED" } });
    }, 1);
    expect(paused).toEqual([]);
    expect(await row(id)).toMatchObject({ status: "SCHEDULED", dueAt: T, claimErrors: 0 });
    await P().campaign.update({ where: { id: s.campaign.id }, data: { status: "ACTIVE" } });
    const acctPaused = await claimWhileLocked(async (tx) => {
      await touch(tx);
      await tx.emailAccount.update({
        where: { id: s.rows[0]!.accountId },
        data: { lifecycle: "PAUSED" },
      });
    }, 1);
    expect(acctPaused).toEqual([]);
    expect(await row(id)).toMatchObject({ status: "SCHEDULED", dueAt: T });
    expect(await P().accountDailyUsage.count()).toBe(0);
    await P().emailAccount.update({
      where: { id: s.rows[0]!.accountId },
      data: { lifecycle: "ACTIVE" },
    });
    expect(await claimDue(P(), fixedClock(T), opts())).toHaveLength(1);
  });

  test("campaign cap interleaving: two claims queue on the campaign usage row, exactly one wins", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 2, campaign: { dailyLimit: 5 } });
    const key = { campaignId: s.campaign.id, day: day("2026-10-20") };
    await P().campaignDailyUsage.create({ data: { ...key, sent: 4 } });
    const got = await claimWhileLocked(
      (tx) =>
        tx.$queryRaw`SELECT 1 FROM "CampaignDailyUsage" WHERE "campaignId" = ${s.campaign.id} FOR UPDATE`,
      2,
      2,
    );
    expect(got).toHaveLength(1);
    const u = await P().campaignDailyUsage.findUniqueOrThrow({ where: { campaignId_day: key } });
    expect([u.sent, u.reserved]).toEqual([4, 1]);
    expect(
      (await P().accountDailyUsage.aggregate({ _sum: { reserved: true } }))._sum.reserved,
    ).toBe(1);
  });

  test("workspace cap interleaving: two claims queue on the workspace usage row, exactly one wins", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 2, workspace: { dailyCap: 5 } });
    const key = { workspaceId: s.ws, day: day("2026-10-20") };
    await P().workspaceDailyUsage.create({ data: { ...key, sent: 4 } });
    const got = await claimWhileLocked(
      (tx) =>
        tx.$queryRaw`SELECT 1 FROM "WorkspaceDailyUsage" WHERE "workspaceId" = ${s.ws} FOR UPDATE`,
      2,
      2,
    );
    expect(got).toHaveLength(1);
    const u = await P().workspaceDailyUsage.findUniqueOrThrow({ where: { workspaceId_day: key } });
    expect([u.sent, u.reserved]).toEqual([4, 1]);
    const camp = await P().campaignDailyUsage.aggregate({ _sum: { reserved: true } });
    expect(camp._sum.reserved).toBe(1);
  });

  test("a lock wait past lock_timeout is contention: pushed back a minute, not a claim error", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const held = new Promise<void>((r) => (locked = r));
    const holder = client().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "CampaignLead" WHERE id = ${s.leads[0]!.cl.id} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 60_000 },
    );
    await held;
    expect(await claimDue(client(), fixedClock(T), opts())).toEqual([]);
    release();
    await holder;
    expect(await row(s.rows[0]!.id)).toMatchObject({
      status: "SCHEDULED",
      claimErrors: 0,
      dueAt: new Date(T.getTime() + 60_000),
    });
  });

  test("never loses a committed claim: a bad row mid-batch is isolated, a late fatal error returns what was claimed", async () => {
    const good = await seedCampaign(P(), { at: T, rows: 2 });
    const bad = await seedCampaign(P(), { at: T, rows: 1 });
    await P().scheduledMessage.update({
      where: { id: good.rows[0]!.id },
      data: { dueAt: new Date(T.getTime() - 120_000) },
    });
    await P().scheduledMessage.update({
      where: { id: bad.rows[0]!.id },
      data: { dueAt: new Date(T.getTime() - 60_000) },
    });
    await P()
      .$executeRaw`UPDATE "CampaignSchedule" SET days = 0 WHERE "campaignId" = ${bad.campaign.id}`;
    const got = await claimDue(P(), fixedClock(T), opts());
    expect(got.map((c) => c.id)).toEqual([good.rows[0]!.id, good.rows[1]!.id]);
    expect(await row(bad.rows[0]!.id)).toMatchObject({ status: "SCHEDULED", claimErrors: 1 });

    const more = await seedCampaign(P(), { at: T, rows: 3 });
    const orig = P().$transaction.bind(P());
    const tx = vi
      .spyOn(P(), "$transaction")
      .mockImplementationOnce(orig as never)
      .mockImplementationOnce(() => Promise.reject(new Error("pool timeout")));
    const kept = await claimDue(P(), fixedClock(T), opts());
    tx.mockRestore();
    expect(kept.map((c) => c.id)).toEqual([more.rows[0]!.id]);
    expect(await row(more.rows[0]!.id)).toMatchObject({
      status: "SENDING",
      claimToken: kept[0]!.claimToken,
    });
    await expect(
      (async () => {
        vi.spyOn(P(), "$transaction").mockRejectedValueOnce(new Error("pool timeout"));
        return claimDue(P(), fixedClock(T), opts());
      })(),
    ).rejects.toThrow("pool timeout"); // nothing claimed yet: the error surfaces
    vi.restoreAllMocks();
  });

  test("one row per (campaignLeadId, stepId) is enforced by the database", async () => {
    const s = await seedCampaign(P(), { at: T, rows: 1 });
    const r = s.rows[0]!;
    await expect(
      planRow(P(), {
        workspaceId: s.ws,
        campaignId: s.campaign.id,
        campaignLeadId: r.campaignLeadId,
        stepId: r.stepId,
        accountId: r.accountId,
        dueAt: T,
        idempotencyKey: "different-key",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("quota helpers", () => {
  const acct = {
    dailyLimit: 30,
    providerCap: 40,
    slowRamp: false,
    rampStartVolume: 2,
    rampIncrementPerDay: 2,
    rampStartedAt: null,
    createdAt: T,
    timezone: "UTC",
  };
  test("effectiveAllowance", () => {
    expect(effectiveAllowance(acct, T)).toBe(20);
    expect(effectiveAllowance({ ...acct, healthCap: 7 }, T)).toBe(7);
    const rewarm = { rewarmStartedAt: T, rewarmStartVolume: 4, rewarmIncrementPerDay: 2, rewarmTarget: 30 };
    expect(effectiveAllowance({ ...acct, ...rewarm }, T)).toBe(4);
    expect(effectiveAllowance({ ...acct, dailyLimit: 10 }, T)).toBe(10);
  });

  test("withTxRetry retries 40P01/40001/P2034 and rethrows the third failure", async () => {
    let n = 0;
    expect(
      await withTxRetry(async () => {
        if (n++ === 0) throw Object.assign(new Error("deadlock"), { code: "40P01" });
        return "ok";
      }),
    ).toBe("ok");
    expect(n).toBe(2);
    n = 0;
    await expect(
      withTxRetry(async () => {
        n++;
        throw Object.assign(new Error("x"), { code: "P2034" });
      }),
    ).rejects.toThrow("x");
    expect(n).toBe(3);
    n = 0;
    await expect(
      withTxRetry(async () => {
        n++;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(n).toBe(1);
  });
});

describe("schema (audit A6)", () => {
  test("the claim's raw-SQL partial index exists (Prisma does not know about it)", async () => {
    const rows = await P().$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'ScheduledMessage_scheduled_due_idx'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(
      /\("dueAt", id\) WHERE \(status = 'SCHEDULED'::"MessageStatus"\)/,
    );
  });
});
