import type { AccountProvider, PrismaClient } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { claimDue } from "../src/dispatch";
import { pickAccount } from "../src/rotation";
import { planRow, seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma as PrismaClient;
const ALL: AccountProvider[] = ["GMAIL", "MICROSOFT", "SMTP"];
const T = new Date("2026-10-20T10:00:00Z");
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.drop();
});

const pick = async (
  campaignId: string,
  o: { leadEsp?: "GOOGLE" | "MICROSOFT" | "OTHER"; sendable?: AccountProvider[] } = {},
) =>
  pickAccount(P(), {
    campaign: await P().campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    leadEsp: o.leadEsp ?? "OTHER",
    now: T,
    stalenessSec: 300,
    sendableProviders: o.sendable ?? ALL,
  });

describe("pickAccount", () => {
  test("30 sequential picks spread 10/10/10", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{ dailyLimit: 50 }, { dailyLimit: 50 }, { dailyLimit: 50 }],
      leads: 30,
    });
    const counts: Record<string, number> = {};
    for (const [i, l] of s.leads.entries()) {
      const a = (await pick(s.campaign.id))!;
      counts[a.id] = (counts[a.id] ?? 0) + 1;
      await planRow(P(), {
        workspaceId: s.ws,
        campaignId: s.campaign.id,
        campaignLeadId: l.cl.id,
        stepId: s.steps[0]!.id,
        accountId: a.id,
        dueAt: new Date(T.getTime() + i),
      });
    }
    expect(Object.values(counts)).toEqual([10, 10, 10]);
  });

  test("tie-break is least sent today, then oldest lastSentAt, then id", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{}, {}] });
    const [a, b] = s.accounts;
    await P().accountDailyUsage.create({
      data: { accountId: a!.id, day: new Date("2026-10-20"), sent: 2 },
    });
    expect((await pick(s.campaign.id))!.id).toBe(b!.id);
    await P().accountDailyUsage.deleteMany();
    await P().emailAccount.update({ where: { id: b!.id }, data: { lastSentAt: T } });
    await P().emailAccount.update({ where: { id: a!.id }, data: { lastSentAt: new Date(0) } });
    expect((await pick(s.campaign.id))!.id).toBe(a!.id);
  });

  test("matchProvider prefers the lead's ESP, falls back otherwise", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{ provider: "SMTP" }, { provider: "GMAIL" }],
      campaign: { matchProvider: true },
    });
    expect((await pick(s.campaign.id, { leadEsp: "GOOGLE" }))!.id).toBe(s.accounts[1]!.id);
    expect(await pick(s.campaign.id, { leadEsp: "MICROSOFT" })).not.toBeNull();
  });

  test("ESP routing: do_not_send excludes, send rules require a match", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{ provider: "MICROSOFT" }, { provider: "SMTP" }],
      campaign: {
        espRoutingRules: [{ action: "do_not_send", recipientEsp: "google", senderEsp: "outlook" }],
      },
    });
    expect((await pick(s.campaign.id, { leadEsp: "GOOGLE" }))!.id).toBe(s.accounts[1]!.id);
    await P().campaign.update({
      where: { id: s.campaign.id },
      data: { espRoutingRules: [{ action: "send", recipientEsp: "all", senderEsp: "outlook" }] },
    });
    expect((await pick(s.campaign.id))!.id).toBe(s.accounts[0]!.id);
  });

  test("accountTags restrict the pool", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{}, { tags: ["warm"] }],
      campaign: { accountTags: ["warm"] },
    });
    for (let i = 0; i < 3; i++) expect((await pick(s.campaign.id))!.id).toBe(s.accounts[1]!.id);
  });

  test("stale, PAUSED, NEEDS_ATTENTION, unverified-provider and exhausted accounts are never picked", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [
        { lastSyncCompletedAt: new Date(T.getTime() - 600_000) },
        { lifecycle: "PAUSED" },
        { lifecycle: "NEEDS_ATTENTION" },
        { provider: "GMAIL" },
        { dailyLimit: 1 },
        {},
      ],
      leads: 1,
    });
    await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: s.leads[0]!.cl.id,
      stepId: s.steps[0]!.id,
      accountId: s.accounts[4]!.id,
      dueAt: T,
    });
    for (let i = 0; i < 4; i++)
      expect((await pick(s.campaign.id, { sendable: ["SMTP"] }))!.id).toBe(s.accounts[5]!.id);
    await P().campaignAccount.deleteMany({ where: { accountId: s.accounts[5]!.id } });
    expect(await pick(s.campaign.id, { sendable: ["SMTP"] })).toBeNull();
  });

  test("an unassigned or deleted account is not eligible", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{ deletedAt: new Date() }] });
    expect(await pick(s.campaign.id)).toBeNull();
  });

  test("shares the claim's account predicate: claimDue claims exactly the accounts pickAccount accepts, in sent order", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [
        { lastSyncCompletedAt: new Date(T.getTime() - 600_000) },
        { lifecycle: "NEEDS_ATTENTION" },
        { provider: "GMAIL" },
        {},
        {},
        {},
      ],
      rows: 6,
    });
    const [, , , e1, e2, e3] = s.accounts;
    // distinct sent counts (2, 1, 0): the least-sent order is e3, e2, e1, so no id tie-break can hide a divergence
    for (const [a, sent] of [
      [e1, 2],
      [e2, 1],
    ] as const)
      await P().accountDailyUsage.create({
        data: { accountId: a!.id, day: new Date("2026-10-20"), sent },
      });
    const claimed = await claimDue(P(), fixedClock(T), {
      limit: 10,
      bootId: "b",
      stalenessSec: 300,
      sendableProviders: ["SMTP"],
    });
    const eligible = [e1!.id, e2!.id, e3!.id];
    expect(claimed.map((r) => r.accountId).sort()).toEqual([...eligible].sort());
    await P().scheduledMessage.deleteMany(); // the rows were only there to drive the claim
    await P().accountDailyUsage.updateMany({ data: { reserved: 0 } });
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = await pick(s.campaign.id, { sendable: ["SMTP"] });
      if (!a) break;
      order.push(a.id);
      await P().campaignAccount.deleteMany({ where: { accountId: a.id } });
    }
    expect(order).toEqual([e3!.id, e2!.id, e1!.id]);
  });

  test("stopForCompanyOnReply: a stale sibling means no pick (the claim would take nothing)", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{}, { lastSyncCompletedAt: null }],
      campaign: { stopForCompanyOnReply: true },
    });
    expect(await pick(s.campaign.id)).toBeNull();
    await P().campaign.update({
      where: { id: s.campaign.id },
      data: { stopForCompanyOnReply: false },
    });
    expect((await pick(s.campaign.id))!.id).toBe(s.accounts[0]!.id);
    await P().campaign.update({
      where: { id: s.campaign.id },
      data: { stopForCompanyOnReply: true },
    });
    await P().emailAccount.update({
      where: { id: s.accounts[1]!.id },
      data: { lastSyncCompletedAt: T },
    });
    expect(await pick(s.campaign.id)).not.toBeNull();
    await P().emailAccount.update({
      where: { id: s.accounts[1]!.id },
      data: { lifecycle: "NEEDS_ATTENTION" },
    });
    expect(await pick(s.campaign.id)).toBeNull();
  });

  test("scheduled rows with cc/bcc count their units; the query count does not grow with accounts", async () => {
    const queries = async (n: number) => {
      const s = await seedCampaign(P(), {
        at: T,
        accounts: Array.from({ length: n }, () => ({ dailyLimit: 3 })),
        leads: 1,
      });
      // 3 units (1 + cc + bcc) fills account 0's allowance of 3
      await planRow(P(), {
        workspaceId: s.ws,
        campaignId: s.campaign.id,
        campaignLeadId: s.leads[0]!.cl.id,
        stepId: s.steps[0]!.id,
        accountId: s.accounts[0]!.id,
        dueAt: T,
        cc: ["a@x.test"],
        bcc: ["b@x.test"],
      });
      let count = 0;
      const wrap = (o: object): object =>
        new Proxy(o, {
          get(t, k) {
            const v = Reflect.get(t, k) as unknown;
            if (typeof v !== "function") return v && typeof v === "object" ? wrap(v) : v;
            return (...a: unknown[]) => {
              count++;
              return (v as (...x: unknown[]) => unknown).apply(t, a);
            };
          },
        });
      const campaign = await P().campaign.findUniqueOrThrow({ where: { id: s.campaign.id } });
      const a = await pickAccount(wrap(P()) as PrismaClient, {
        campaign,
        leadEsp: "OTHER",
        now: T,
        stalenessSec: 300,
        sendableProviders: ALL,
      });
      if (n > 1) expect(a!.id).not.toBe(s.accounts[0]!.id);
      else expect(a).toBeNull();
      return count;
    };
    expect(await queries(1)).toBe(await queries(8));
  });
});
