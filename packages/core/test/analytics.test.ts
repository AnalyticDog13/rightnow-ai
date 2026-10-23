import { randomBytes } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AccountError } from "../src/accounts/service";
import { fixedClock } from "../src/clock";
import { accountAnalytics, bounceBreakdown } from "../src/analytics/accounts";
import { crmReport } from "../src/analytics/crm-report";
import { analytics, analyticsGroups } from "../src/analytics/metrics";
import { analyticsQuery } from "../src/analytics/query";
import { updateOpportunity } from "../src/crm/opportunities";
import { AT, analyticsFixture, day2 } from "./analytics-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const q = (o: Record<string, unknown> = {}) => analyticsQuery.parse(day2(o));
const run = (ws: string, o: Record<string, unknown> = {}) => analytics(P(), ws, q(o));
const row = <T extends { key: string }>(rows: T[], key: string) => rows.find((r) => r.key === key)!;

describe("analytics (D42)", () => {
  test("exact fixture", async () => {
    const f = await analyticsFixture(P());
    const { total } = await run(f.ws, { campaignIds: f.C.id });
    expect(total).toMatchObject({
      sent: 5,
      contacted: 4,
      newLeadsContacted: 3, // L1 was first mailed on 11-01 (C2)
      rateBase: 4,
      opened: 1,
      opens: 2,
      machineOpens: 1,
      clicked: 1,
      clicks: 1,
      clickedSends: 1,
      replied: 2,
      replies: 2,
      autoReplies: 1,
      hardBounced: 2,
      softBounced: 1,
      unknownBounced: 0,
      complaints: 1,
      unsubscribed: 1,
      completed: 1,
      meetings: 1,
      opportunities: 2,
      opportunityValue: "1500.00",
      won: 1,
      wonValue: "1000.00",
      cashCollected: "800.00",
      rates: { open: 0.25, click: 0.2, reply: 0.5, positiveReply: 1, bounce: 0.4 },
    });
    expect(
      (await run(f.ws, { campaignIds: f.C.id, includeAutoReplies: "true" })).total.replied,
    ).toBe(3);
    expect((await run(f.ws, { campaignIds: f.C.id, replyBase: "sent" })).total.rates.reply).toBe(
      0.4,
    );

    // I5 / I7: the step, variant, account and day views divide by the group's unique leads sent
    const v = await run(f.ws, { campaignIds: f.C.id, groupBy: "variant" });
    const pick = (k: string) => {
      const r = row(v.rows, k);
      return [r.sent, r.rateBase, r.replied, r.rates.reply, r.meetings, r.completed];
    };
    expect(pick(f.S1.v.A!.id)).toEqual([2, 2, 1, 0.5, 0, null]);
    expect(pick(f.S1.v.B!.id)).toEqual([2, 2, 0, 0, 0, null]);
    expect(pick(f.S2.v.A!.id)).toEqual([1, 1, 1, 1, 1, null]);
    expect(row(v.rows, f.S1.v.A!.id).label).toBe("Step 1 A");
    expect(
      (await run(f.ws, { campaignIds: f.C.id, groupBy: "variant", replyBase: "sent" })).rows.find(
        (r) => r.key === f.S1.v.A!.id,
      )!.rateBase,
    ).toBe(2);

    // M5: L3's reply, received by X, counts for its sender Y
    const a = await run(f.ws, { campaignIds: f.C.id, groupBy: "account" });
    expect([row(a.rows, f.X.id).sent, row(a.rows, f.X.id).replied]).toEqual([3, 1]);
    expect([row(a.rows, f.Y.id).sent, row(a.rows, f.Y.id).replied]).toEqual([2, 1]);
    expect(row(a.rows, f.X.id).label).toBe(f.X.email);

    const c = await run(f.ws, { groupBy: "campaign" });
    expect(row(c.rows, f.C.id)).toMatchObject({ label: "Campaign C", sent: 5, completed: 1 });
    expect(row(c.rows, f.C2.id)).toMatchObject({ sent: 1, contacted: 1, completed: 0 });

    for (const seg of [{ esp: "GOOGLE" }, { listId: f.K.id }, { tag: "vip" }])
      expect((await run(f.ws, { campaignIds: f.C.id, ...seg })).total).toMatchObject({
        sent: 2,
        contacted: 1,
      });
    expect((await run(f.ws, { esp: "GOOGLE", groupBy: "esp" })).rows.map((r) => r.key)).toEqual([
      "GOOGLE",
    ]);

    const all = (await run(f.ws)).total;
    expect([all.sent, all.contacted, all.newLeadsContacted]).toEqual([6, 4, 3]);
  });

  test("GDPR-erased lead", async () => {
    const f = await analyticsFixture(P());
    await P().event.updateMany({ where: { leadId: f.L3.id }, data: { leadId: null } });
    const { total } = await run(f.ws, { campaignIds: f.C.id });
    // perLead (D34): an erased lead's events count once each, as in health
    expect(total).toMatchObject({ replied: 2, unsubscribed: 1, complaints: 2 });
  });

  test("day buckets follow tz", async () => {
    const f = await analyticsFixture(P());
    await P().event.create({
      data: { ...f.ev("ACCEPTED", AT("2026-11-02T23:30:00Z"), f.sends.s1aL1), workspaceId: f.ws },
    });
    const utc = await run(f.ws, { campaignIds: f.C.id, groupBy: "day", to: "2026-11-03" });
    expect(utc.rows.map((r) => [r.key, r.sent])).toEqual([
      ["2026-11-02", 6],
      ["2026-11-03", 0],
    ]);
    const tokyo = await run(f.ws, {
      campaignIds: f.C.id,
      groupBy: "day",
      tz: "Asia/Tokyo",
      to: "2026-11-03",
    });
    // 23:30Z is 08:30 on 11-03 in Tokyo; the other C sends (09:00-11:00Z) are evening of 11-02
    expect(row(tokyo.rows, "2026-11-03").sent).toBe(1);
    expect((await run(f.ws, { campaignIds: f.C.id, tz: "Asia/Tokyo" })).total.sent).toBe(5);

    // America/New_York leaves DST on 2026-11-01: 00:30 EDT and 23:30 EST are both that day
    const ny = await analyticsFixture(P());
    await P().event.createMany({
      data: [
        ny.ev("ACCEPTED", AT("2026-11-01T04:30:00Z"), ny.sends.s1aL1),
        ny.ev("ACCEPTED", AT("2026-11-02T04:30:00Z"), ny.sends.s1bL2),
        ny.ev("ACCEPTED", AT("2026-11-01T03:59:00Z"), ny.sends.s1aL3), // 23:59 EDT on 10-31
      ],
    });
    const week = await run(ny.ws, {
      campaignIds: ny.C.id,
      groupBy: "day",
      tz: "America/New_York",
      from: "2026-10-29",
      to: "2026-11-04",
    });
    expect(week.rows.map((r) => r.key)).toEqual([
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
    expect(row(week.rows, "2026-10-31").sent).toBe(1);
    expect(row(week.rows, "2026-11-01").sent).toBe(2);
    expect(row(week.rows, "2026-11-02").sent).toBe(5);
    expect(row(week.rows, "2026-10-29")).toMatchObject({
      sent: 0,
      rateBase: 0,
      rates: { reply: null },
    });
  });

  test("query validation", async () => {
    const ws = (await analyticsFixture(P())).ws;
    const status = async (o: Record<string, unknown>) => {
      try {
        await run(ws, o);
        return 200;
      } catch (e) {
        if (e instanceof AccountError) return e.status;
        if ((e as Error).name === "ZodError") return 400;
        throw e;
      }
    };
    expect(await status({ from: "2026-11-03" })).toBe(400); // to < from
    expect(await status({ from: "2025-10-28", to: "2026-12-02" })).toBe(400); // 401 days
    expect(await status({ from: "2025-10-28", to: "2026-12-01" })).toBe(200); // 400 days
    expect(await status({ tz: "Mars/Base" })).toBe(400);
    expect(await status({ tz: "America/Nowhere" })).toBe(400); // passes the pattern, Postgres says 22023
    expect(await status({ tz: "x'; drop table" })).toBe(400);
    expect(
      await status({ campaignIds: Array.from({ length: 101 }, (_, i) => `c${i}`).join(",") }),
    ).toBe(400);
    expect(await status({ groupBy: "list" })).toBe(400);
    expect(await status({ from: "2026-02-30", to: "2026-03-01" })).toBe(400);
  });

  test("step 1 deleted", async () => {
    const f = await analyticsFixture(P());
    // the sequence editor soft-deletes S1 and renumbers S2 to 1 (I6)
    await P().sequenceStep.update({
      where: { id: f.S1.id },
      data: { deletedAt: AT("2026-11-02T20:00:00Z") },
    });
    await P().sequenceStep.update({ where: { id: f.S2.id }, data: { order: 1 } });
    const s = await f.send(f.C.id, f.L2, f.S2, f.S2.v.A!.id, f.X.id);
    await P().event.create({ data: f.ev("ACCEPTED", AT("2026-11-03T10:00:00Z"), s) });
    const t = await run(f.ws, { campaignIds: f.C.id, from: "2026-11-03", to: "2026-11-03" });
    expect([t.total.sent, t.total.contacted, t.total.newLeadsContacted]).toEqual([1, 0, 0]);
    const steps = await run(f.ws, { campaignIds: f.C.id, groupBy: "step" });
    expect(row(steps.rows, f.S1.id).label).toBe("Step 1 (deleted)");
    expect(row(steps.rows, f.S2.id).label).toBe("Step 1");
    // the follow-up is not a first contact in any group either: only a lead's first ACCEPTED is flagged
    const two = { campaignIds: f.C.id, from: "2026-11-02", to: "2026-11-03" };
    const days = await run(f.ws, { ...two, groupBy: "day" });
    expect(row(days.rows, "2026-11-03")).toMatchObject({ contacted: 0, newLeadsContacted: 0 });
    const sum = (k: "contacted" | "newLeadsContacted") => days.rows.reduce((n, r) => n + r[k], 0);
    expect([sum("contacted"), sum("newLeadsContacted")]).toEqual([
      days.total.contacted,
      days.total.newLeadsContacted,
    ]);
    const s2 = row((await run(f.ws, { ...two, groupBy: "step" })).rows, f.S2.id);
    expect(s2).toMatchObject({ contacted: 0, newLeadsContacted: 0 });
  });

  test("crmReport", async () => {
    const f = await analyticsFixture(P());
    const r = await crmReport(P(), f.ws, q());
    expect(r).toMatchObject({
      currency: "USD",
      pipelineValue: "500.00",
      openCount: 1,
      avgDealSize: "1000.00",
      wonValue: "1000.00",
      cashCollected: "800.00",
      annualizedClosed: "365000.00",
      revenuePerLead: "200.00",
      revenueByCampaign: [
        { campaignId: f.C.id, name: "Campaign C", won: 1, cashCollected: "800.00" },
      ],
    });
    const pct = (name: string) =>
      r.conversionByStage.find((s) => s.stageId === f.st(name))!.reachedPct;
    expect([
      pct("Replied"),
      pct("Interested"),
      pct("Negotiation"),
      pct("Closed Won"),
      pct("Closed Lost"),
    ]).toEqual([1, 1, 0.5, 0.5, 0]);
    expect(r.conversionByStage.find((s) => s.stageId === f.st("Interested"))!.count).toBe(1);
    // annualized over 2 days halves; pipeline value is the current open pipeline (range-independent)
    const two = await crmReport(P(), f.ws, q({ to: "2026-11-03" }));
    expect(two.annualizedClosed).toBe("182500.00");
    const later = await crmReport(P(), f.ws, q({ from: "2026-12-01", to: "2026-12-01" }));
    expect(later).toMatchObject({
      pipelineValue: "500.00",
      wonValue: "0.00",
      avgDealSize: null,
      revenuePerLead: null,
    });
    expect(later.conversionByStage.every((s) => s.reachedPct === null)).toBe(true);
    // I1: "current" figures hide deals of soft-deleted leads, as the board does; history keeps them (D40)
    await P().lead.update({
      where: { id: f.L3.id },
      data: { deletedAt: AT("2026-11-02T20:00:00Z") },
    });
    const gone = await crmReport(P(), f.ws, q());
    expect([gone.pipelineValue, gone.openCount]).toEqual(["0.00", 0]);
    expect(gone.conversionByStage.find((s) => s.stageId === f.st("Interested"))!.count).toBe(1);
    expect(gone.wonValue).toBe("1000.00");
  });

  test("reopened deal counted once", async () => {
    const f = await analyticsFixture(P());
    const clock = fixedClock(AT("2026-11-02T18:00:00Z"));
    await updateOpportunity(P(), clock, f.ws, null, f.won.id, { stageId: f.st("Negotiation") });
    clock.advance(60_000);
    await updateOpportunity(P(), clock, f.ws, null, f.won.id, { stageId: f.st("Closed Won") });
    const { total } = await run(f.ws, { campaignIds: f.C.id });
    expect([total.won, total.wonValue, total.cashCollected]).toEqual([1, "1000.00", "800.00"]);
    expect((await crmReport(P(), f.ws, q())).cashCollected).toBe("800.00");
  });

  test("filters by campaign fields", async () => {
    const f = await analyticsFixture(P());
    const zero = {
      sent: 0,
      contacted: 0,
      replied: 0,
      meetings: 0,
      opportunities: 0,
      won: 0,
      completed: 0,
      rates: { open: null, click: null, reply: null, positiveReply: null, bounce: null },
    };
    for (const o of [
      { status: "completed" },
      { campaignTag: "nope" },
      { ownerId: "nobody" },
      { campaignIds: "other" },
    ])
      expect((await run(f.ws, o)).total).toMatchObject(zero);
    expect(
      (await run(f.ws, { status: "active", campaignTag: "q4", ownerId: "u1" })).total,
    ).toMatchObject({
      sent: 5,
      replied: 2,
    });
    // M8: a reply without a campaign never counts
    await P().event.create({
      data: f.ev("REPLY", AT("2026-11-02T12:30:00Z"), { leadId: f.L5.id, accountId: f.X.id }),
    });
    expect((await run(f.ws)).total.replied).toBe(2);
  });

  test("bounceBreakdown", async () => {
    const f = await analyticsFixture(P());
    const b = await bounceBreakdown(P(), f.ws, q());
    expect(b).toEqual({
      hard: 2,
      soft: 1,
      unknown: 0,
      reasons: [
        { type: "BOUNCE_HARD", reason: "550 5.1.1 user unknown", count: 2 },
        { type: "BOUNCE_SOFT", reason: "mailbox full", count: 1 },
        { type: "SEND_FAILED", reason: "550 no such user", count: 1 },
      ],
    });
  });

  test("query count", async () => {
    const f = await analyticsFixture(P());
    let n = 0;
    const counted = P().$extends({
      query: {
        $allOperations({ args, query }) {
          n++;
          return query(args);
        },
      },
    });
    const r = await analytics(counted as never, f.ws, q({ groupBy: "variant" }));
    expect(r.rows).toHaveLength(4); // S1A, S1B, S2A and C2's variant
    expect(n).toBeLessThanOrEqual(4);
  });

  test("an analytics page load runs the heavy event statement at most twice", async () => {
    const f = await analyticsFixture(P());
    let heavy = 0;
    const counted = P().$extends({
      query: {
        $allOperations({ args, query }) {
          if (JSON.stringify(args ?? null).includes("first_c")) heavy++;
          return query(args);
        },
      },
    }) as never;
    const BYS = ["campaign", "step", "variant", "day"] as const;
    const g = await analyticsGroups(counted, f.ws, q(), [...BYS]);
    expect(heavy).toBe(1);
    // one scan gives each grouping exactly what its own call gives
    for (const by of BYS) expect(g[by]).toEqual(await run(f.ws, { groupBy: by }));
    heavy = 0;
    await accountAnalytics(counted, f.ws, q(), AT("2026-11-02T20:00:00Z"));
    await crmReport(counted, f.ws, q());
    await bounceBreakdown(counted, f.ws, q());
    expect(heavy).toBe(1);
  });

  test("workspace scope", async () => {
    const f = await analyticsFixture(P());
    const other = await P().workspace.create({
      data: { name: "O", slug: `o-${randomBytes(4).toString("hex")}` },
    });
    expect((await run(other.id, { campaignIds: f.C.id })).total.sent).toBe(0);
    expect((await crmReport(P(), other.id, q())).revenueByCampaign).toEqual([]);
  });
});
