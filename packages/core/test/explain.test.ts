import type { AccountProvider, PrismaClient } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { whyNotSending } from "../src/explain";
import { pickAccount } from "../src/rotation";
import { planRow, seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma as PrismaClient;
const T = new Date("2026-10-20T10:00:00Z"); // Tuesday
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.drop();
});

const ALL: AccountProvider[] = ["SMTP", "GMAIL", "MICROSOFT"];
const why = (ws: string, id: string, sendable: AccountProvider[] = ALL) =>
  whyNotSending(P(), fixedClock(T), ws, id, { stalenessSec: 300, sendable });
const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code).sort();

describe("whyNotSending", () => {
  test("a healthy campaign is sending with no reasons", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 1 });
    expect(await why(s.ws, s.campaign.id)).toEqual({ sending: true, reasons: [] });
  });

  test.each([
    ["DRAFT", "draft"],
    ["PAUSED", "paused"],
    ["COMPLETED", "completed"],
  ] as const)("%s campaign reports only %s", async (status, code) => {
    const s = await seedCampaign(P(), { at: T, leads: 1, campaign: { status } });
    const r = await why(s.ws, s.campaign.id);
    expect(codes(r)).toEqual([code]);
    expect(r.sending).toBe(false);
  });

  test("not_started and ended", async () => {
    const a = await seedCampaign(P(), {
      at: T,
      leads: 1,
      campaign: { startAt: new Date("2026-11-01") },
    });
    expect(codes(await why(a.ws, a.campaign.id))).toEqual(["not_started"]);
    const b = await seedCampaign(P(), {
      at: T,
      leads: 1,
      campaign: { endAt: new Date("2026-10-01") },
    });
    expect(codes(await why(b.ws, b.campaign.id))).toEqual(["ended"]);
  });

  test("G-I1: leads waiting for verification are reported, informational", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 3 });
    await P().lead.updateMany({
      where: { id: { in: s.leads.slice(0, 2).map((l) => l.lead.id) } },
      data: { verificationStatus: "PENDING_JOB" },
    });
    expect(await why(s.ws, s.campaign.id)).toEqual({
      sending: true,
      reasons: [
        {
          code: "leads_verifying",
          message: "2 lead(s) are waiting for email verification.",
          blocking: false,
        },
      ],
    });
  });

  test("stale account is sync_pending, in plain language, not an error", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      leads: 1,
      accounts: [{ lastSyncCompletedAt: null }],
    });
    const r = await why(s.ws, s.campaign.id);
    expect(r.sending).toBe(false);
    expect(r.reasons).toEqual([
      expect.objectContaining({ code: "sync_pending", accountIds: [s.accounts[0]!.id] }),
    ]);
    expect(r.reasons[0]!.message).toMatch(/waiting for their next inbox sync.*sync status/i);
    expect(r.reasons[0]!.message).not.toMatch(/later release/i);
  });

  test("provider not verified", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 1 });
    const r = await why(s.ws, s.campaign.id, []);
    expect(r.reasons).toEqual([
      expect.objectContaining({
        code: "provider_not_verified",
        accountIds: s.accounts.map((a) => a.id).sort(),
      }),
    ]);
  });

  test("outside the window gives the next window start", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      leads: 1,
      schedules: [{ timezone: "UTC", days: 127, from: "12:00", to: "13:00" }],
    });
    const r = await why(s.ws, s.campaign.id);
    expect(codes(r)).toEqual(["outside_window"]);
    expect(r.nextWindowAt).toEqual(new Date("2026-10-20T12:00:00Z"));
  });

  test("unavailable accounts, then no accounts", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      leads: 1,
      accounts: [{ lifecycle: "NEEDS_ATTENTION" }],
    });
    expect(codes(await why(s.ws, s.campaign.id))).toEqual(["accounts_unavailable"]);
    await P().campaignAccount.deleteMany({ where: { campaignId: s.campaign.id } });
    expect(codes(await why(s.ws, s.campaign.id))).toEqual(["no_accounts"]);
  });

  test("no physical address", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 1, workspace: { physicalAddress: null } });
    expect(codes(await why(s.ws, s.campaign.id))).toEqual(["no_physical_address"]);
  });

  test("account, campaign and workspace quota with the reset time", async () => {
    const day = new Date("2026-10-20");
    const a = await seedCampaign(P(), { at: T, leads: 1, accounts: [{ dailyLimit: 2 }] });
    await P().accountDailyUsage.create({ data: { accountId: a.accounts[0]!.id, day, sent: 2 } });
    expect((await why(a.ws, a.campaign.id)).reasons).toEqual([
      expect.objectContaining({
        code: "account_quota_reached",
        at: new Date("2026-10-21T00:00:00Z"),
      }),
    ]);
    const c = await seedCampaign(P(), { at: T, leads: 1, campaign: { dailyLimit: 1 } });
    await P().campaignDailyUsage.create({ data: { campaignId: c.campaign.id, day, sent: 1 } });
    expect(codes(await why(c.ws, c.campaign.id))).toEqual(["campaign_quota_reached"]);
    const w = await seedCampaign(P(), { at: T, leads: 1, workspace: { dailyCap: 1 } });
    await P().workspaceDailyUsage.create({ data: { workspaceId: w.ws, day, sent: 1 } });
    expect(codes(await why(w.ws, w.campaign.id))).toEqual(["workspace_quota_reached"]);
  });

  test("no eligible leads", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 0 });
    expect(codes(await why(s.ws, s.campaign.id))).toEqual(["no_eligible_leads"]);
  });

  test("claim errors, held rows and suppressed leads are reported alongside", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 3, rows: 1 });
    await P().scheduledMessage.update({
      where: { id: s.rows[0]!.id },
      data: { error: "claim_error: boom" },
    });
    await planRow(P(), {
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      campaignLeadId: s.leads[1]!.cl.id,
      stepId: s.steps[0]!.id,
      accountId: s.accounts[0]!.id,
      dueAt: T,
      status: "HELD",
    });
    await P().campaignLead.update({
      where: { id: s.leads[2]!.cl.id },
      data: { state: "STOPPED", stopReason: "SUPPRESSED" },
    });
    const r = await why(s.ws, s.campaign.id);
    expect(codes(r)).toEqual(["claim_errors", "held_messages", "leads_suppressed"]);
    expect(r.sending).toBe(true);
  });

  test("all reasons at once", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      leads: 1,
      workspace: { physicalAddress: null },
      accounts: [{ lastSyncCompletedAt: null }],
      schedules: [{ timezone: "UTC", days: 127, from: "12:00", to: "13:00" }],
    });
    expect(codes(await why(s.ws, s.campaign.id))).toEqual([
      "no_physical_address",
      "outside_window",
      "sync_pending",
    ]);
  });

  test("workspace scoped: a foreign campaign is not found", async () => {
    const s = await seedCampaign(P(), { at: T });
    await expect(why("other", s.campaign.id)).rejects.toMatchObject({ status: 404 });
  });

  test("stopForCompanyOnReply with one stale account blocks, never sending:true", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      leads: 1,
      accounts: [{}, { lastSyncCompletedAt: null }],
      campaign: { stopForCompanyOnReply: true },
    });
    const r = await why(s.ws, s.campaign.id);
    expect(r.sending).toBe(false);
    expect(r.reasons).toContainEqual(
      expect.objectContaining({ code: "company_stop_waiting_for_sync", blocking: true }),
    );
    expect(r.reasons.find((x) => x.code === "company_stop_waiting_for_sync")!.message).toMatch(
      /^(?!.*later release).*next inbox sync.*sync status/i,
    );
    await P().campaign.update({
      where: { id: s.campaign.id },
      data: { stopForCompanyOnReply: false },
    });
    const off = await why(s.ws, s.campaign.id); // same state without the flag: sibling is informational
    expect(off.sending).toBe(true);
    expect(off.reasons).toEqual([
      expect.objectContaining({ code: "sync_pending", blocking: false }),
    ]);
  });

  test("an account full through SCHEDULED rows is reported, as pickAccount sees it", async () => {
    const s = await seedCampaign(P(), { at: T, leads: 1, rows: 1, accounts: [{ dailyLimit: 1 }] });
    const r = await why(s.ws, s.campaign.id);
    expect(r.sending).toBe(false);
    expect(r.reasons).toEqual([
      expect.objectContaining({ code: "account_quota_reached", blocking: true }),
    ]);
    expect(
      await pickAccount(P(), {
        campaign: s.campaign,
        leadEsp: "OTHER",
        now: T,
        stalenessSec: 300,
        sendableProviders: ALL,
      }),
    ).toBeNull();
  });
});
