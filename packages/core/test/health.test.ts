import { randomBytes } from "node:crypto";
import type { EmailAccount, EventType, Prisma } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resumeAccount } from "../src/accounts/service";
import { displayStatus } from "../src/accounts/status";
import { resumeCampaign } from "../src/campaigns/launch";
import { fixedClock } from "../src/clock";
import {
  evaluateHealth,
  healthInputs,
  healthScore,
  type HealthInputs,
} from "../src/deliverability/health";
import { effectiveAllowance } from "../src/quota";
import { seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const H = 3600_000;
const ago = (ms: number) => new Date(T.getTime() - ms);
const acct = (id: string) => P().emailAccount.findUniqueOrThrow({ where: { id } });
const camp = (id: string) => P().campaign.findUniqueOrThrow({ where: { id } });
const audits = (action: string) =>
  P().auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });

/**
 * `n` events of `type` for an account (and campaign), at `at` (default an hour before T), each tied to a send of ours
 * unless `untargeted` (a DSN or ARF that matched no send).
 */
async function events(
  a: Pick<EmailAccount, "id" | "workspaceId">,
  type: EventType,
  n: number,
  o: {
    at?: Date;
    campaignId?: string;
    meta?: Prisma.InputJsonObject;
    untargeted?: boolean;
    leadId?: string;
  } = {},
) {
  await P().event.createMany({
    data: Array.from({ length: n }, () => ({
      workspaceId: a.workspaceId,
      type,
      occurredAt: o.at ?? ago(H),
      accountId: a.id,
      campaignId: o.campaignId ?? null,
      leadId: o.leadId ?? null,
      meta: o.meta ?? {},
      scheduledMessageId: o.untargeted ? null : `sm-${randomBytes(4).toString("hex")}`,
      dedupeKey: `t:${randomBytes(8).toString("hex")}`,
    })),
  });
}

const ZERO: HealthInputs = {
  accepted7d: 0,
  hard7d: 0,
  soft7d: 0,
  accepted30d: 0,
  complaints30d: 0,
  providerErrors24h: 0,
  syncFailing: false,
  dnsLevel: null,
  warmup: null,
  placement: null,
};

describe("healthScore", () => {
  test("damped rates, capped terms, clamped result", () => {
    expect(healthScore(ZERO)).toBe(100);
    expect(healthScore({ ...ZERO, hard7d: 3, accepted7d: 100 })).toBe(70);
    expect(healthScore({ ...ZERO, hard7d: 1, accepted7d: 5 })).toBe(60); // 1/20 = 5 % → −40 (capped)
    expect(healthScore({ ...ZERO, complaints30d: 1, accepted30d: 500 })).toBe(90); // 1/1000
    expect(healthScore({ ...ZERO, dnsLevel: "block" })).toBe(75);
    expect(healthScore({ ...ZERO, dnsLevel: "warn" })).toBe(90);
    expect(healthScore({ ...ZERO, providerErrors24h: 1 })).toBe(90);
    expect(healthScore({ ...ZERO, providerErrors24h: 5 })).toBe(80);
    expect(
      healthScore({
        ...ZERO,
        hard7d: 50,
        accepted7d: 100,
        soft7d: 50,
        complaints30d: 50,
        providerErrors24h: 9,
        syncFailing: true,
        dnsLevel: "block",
      }),
    ).toBe(0);
  });
});

describe("evaluateHealth: accounts", () => {
  test("throttle and restore: cap 20 → 40 → null over 48 h with no extra sends; one snapshot per account-day", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{ dailyLimit: 80, providerCap: 200 }],
      workspace: { healthSlowdownPct: 25 },
    });
    const A = s.accounts[0]!;
    await events(A, "ACCEPTED", 100, { at: ago(2 * H) });
    await events(A, "BOUNCE_HARD", 2);
    await events(A, "SEND_FAILED", 1, { meta: { error: "x", scope: "recipient" } }); // a hard bounce too
    const clock = fixedClock(T);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ throttled: 1, paused: 0 });
    let a = await acct(A.id);
    expect(a).toMatchObject({
      healthCap: 20,
      healthCapAt: T,
      lifecycle: "ACTIVE",
      healthScore: 70,
    });
    expect(effectiveAllowance(a, T)).toBe(20);
    expect(await audits("account.health_throttle")).toMatchObject([
      { target: A.id, meta: { reason: "bounce_rate", hardPct: 3, cap: 20 } },
    ]);

    clock.advance(H); // within 24 h: nothing changes
    expect(await evaluateHealth(P(), clock)).toMatchObject({ throttled: 0, restored: 0 });
    expect(await acct(A.id)).toMatchObject({ healthCap: 20, healthCapAt: T });
    expect(await P().healthSnapshot.findMany()).toMatchObject([
      { accountId: A.id, day: new Date("2026-10-20T00:00:00Z"), score: 70 },
    ]);

    clock.advance(23 * H);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ restored: 1 });
    expect(await acct(A.id)).toMatchObject({ healthCap: 40, healthCapAt: clock.now() });
    clock.advance(24 * H);
    await evaluateHealth(P(), clock);
    a = await acct(A.id);
    expect(a.healthCap).toBeNull();
    expect(effectiveAllowance(a, clock.now())).toBe(80);
    // the old bounces are still in the 7-day window, but they came before the last health change
    clock.advance(5 * 60_000);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ throttled: 0 });
    expect((await acct(A.id)).healthCap).toBeNull();
    expect(await P().healthSnapshot.count()).toBe(3); // 20th, 21st, 22nd
  });

  test("I4: 1 hard bounce of 21 accepted throttles (damped) but never pauses below 50 sends", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{ dailyLimit: 50 }] });
    const A = s.accounts[0]!;
    await events(A, "ACCEPTED", 21);
    await events(A, "BOUNCE_HARD", 1);
    expect(await evaluateHealth(P(), fixedClock(T))).toMatchObject({ throttled: 1, paused: 0 });
    expect(await acct(A.id)).toMatchObject({ lifecycle: "ACTIVE", healthCap: 25 }); // 50 % of 50
  });

  test("pause on bounce threshold and on complaints; user pause and NEEDS_ATTENTION untouched; resume is not re-paused", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{}, { lifecycle: "PAUSED" }, { lifecycle: "NEEDS_ATTENTION" }, {}],
    });
    const [A, U, N, C] = s.accounts as [EmailAccount, EmailAccount, EmailAccount, EmailAccount];
    for (const x of [A, U, N]) {
      await events(x, "ACCEPTED", 100);
      await events(x, "BOUNCE_HARD", 4);
    }
    await events(C, "ACCEPTED", 1000);
    await events(C, "COMPLAINT", 2);
    const clock = fixedClock(T);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ paused: 2 });
    const a = await acct(A.id);
    expect(a).toMatchObject({
      lifecycle: "PAUSED",
      pausedUntil: null,
      lastError: { kind: "SOFT_BOUNCE", code: "bounce_rate" },
    });
    expect(displayStatus(a, T)).toBe("SOFT_BOUNCE_ERROR");
    expect(await acct(C.id)).toMatchObject({
      lifecycle: "PAUSED",
      lastError: { kind: "SOFT_BOUNCE", code: "complaint_rate" },
    });
    expect(await acct(U.id)).toMatchObject({ lifecycle: "PAUSED", lastError: null });
    expect(await acct(N.id)).toMatchObject({ lifecycle: "NEEDS_ATTENTION", lastError: null });
    expect(await audits("account.health_pause")).toHaveLength(2);

    // I3: the user resumes; the same bounces do not pause it again
    clock.advance(H);
    await resumeAccount(P(), s.ws, A.id, { clock });
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "ACTIVE",
      lastError: null,
      healthResetAt: clock.now(),
    });
    clock.advance(5 * 60_000);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ paused: 0 });
    expect((await acct(A.id)).lifecycle).toBe("ACTIVE");
  });

  test("I5: provider errors decay over 24 h; restore is allowed once they are gone", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{}] });
    const A = s.accounts[0]!;
    await events(A, "SEND_FAILED", 2, { meta: { error: "x", scope: "account" } });
    await events(A, "SEND_FAILED", 1, { meta: { error: "x", scope: "unknown" } });
    await events(A, "SEND_FAILED", 3, { meta: { error: "mime_invalid" } }); // no scope: not a provider error
    await P().syncRun.createMany({
      data: [1, 2].map((i) => ({
        accountId: A.id,
        mode: "INCREMENTAL" as const,
        startedAt: ago(i * 60_000),
        error: "TransientBeforeSendError",
      })),
    });
    const clock = fixedClock(T);
    expect((await healthInputs(P(), [A.id], T)).get(A.id)).toMatchObject({ providerErrors24h: 5 });
    expect(await evaluateHealth(P(), clock)).toMatchObject({ throttled: 1 });
    expect(await audits("account.health_throttle")).toMatchObject([
      { meta: { reason: "provider_errors", providerErrors24h: 5 } },
    ]);
    clock.advance(25 * H);
    expect((await healthInputs(P(), [A.id], clock.now())).get(A.id)).toMatchObject({
      providerErrors24h: 0,
    });
    expect(await evaluateHealth(P(), clock)).toMatchObject({ restored: 1 });
  });

  test("I11: a DNS block caps the account; an ok check and 24 h restore it", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{ dailyLimit: 50 }] });
    const A = s.accounts[0]!;
    const domain = A.email.split("@")[1]!;
    const check = (level: string) =>
      P().domainCheck.upsert({
        where: { workspaceId_domain: { workspaceId: s.ws, domain } },
        create: { workspaceId: s.ws, domain, level, checkedAt: T, report: {}, selectors: [] },
        update: { level },
      });
    await check("block");
    const clock = fixedClock(T);
    await evaluateHealth(P(), clock);
    expect(await acct(A.id)).toMatchObject({ healthCap: 25, healthScore: 75 });
    expect(await audits("account.health_throttle")).toMatchObject([
      { meta: { reason: "dns_block" } },
    ]);
    clock.advance(25 * H);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ restored: 0 }); // still blocked
    await check("ok");
    expect(await evaluateHealth(P(), clock)).toMatchObject({ restored: 1 });
    expect((await acct(A.id)).healthCap).toBeNull(); // 50 ≥ the allowance without health
  });

  test("a re-warming account is paused too", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{ lifecycle: "REWARMING" }] });
    const A = s.accounts[0]!;
    await events(A, "ACCEPTED", 100);
    await events(A, "BOUNCE_HARD", 4);
    expect(await evaluateHealth(P(), fixedClock(T))).toMatchObject({ paused: 1 });
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "PAUSED",
      lastError: { kind: "SOFT_BOUNCE", code: "bounce_rate" },
    });
  });

  test("untargeted DSNs and ARFs (no send of ours, unauthenticated From) change nothing", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{}] });
    const A = s.accounts[0]!;
    await events(A, "ACCEPTED", 1000);
    await events(A, "BOUNCE_HARD", 40, { untargeted: true });
    await events(A, "BOUNCE_SOFT", 40, { untargeted: true });
    await events(A, "COMPLAINT", 5, { untargeted: true });
    expect((await healthInputs(P(), [A.id], T)).get(A.id)).toMatchObject({
      hard7d: 0,
      soft7d: 0,
      complaints30d: 0,
    });
    expect(await evaluateHealth(P(), fixedClock(T))).toMatchObject({ throttled: 0, paused: 0 });
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "ACTIVE",
      healthCap: null,
      healthScore: 100,
    });
  });

  test("SOFT/UNKNOWN bounces and sync failures lower the score", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{}, { syncErrors: 5 }] });
    const [A, B] = s.accounts as [EmailAccount, EmailAccount];
    await events(A, "ACCEPTED", 100);
    await events(A, "BOUNCE_SOFT", 6);
    await events(A, "BOUNCE_UNKNOWN", 4);
    await evaluateHealth(P(), fixedClock(T));
    expect((await acct(A.id)).healthScore).toBe(90); // 10 % soft → −20, capped at −10
    expect((await acct(B.id)).healthScore).toBe(80);
  });
  test("A-1: one lead's duplicate reports count once (forged ARFs/DSNs cannot pause an account)", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{}, {}] });
    const [A, B] = s.accounts as [EmailAccount, EmailAccount];
    await events(A, "ACCEPTED", 1000);
    await events(A, "COMPLAINT", 3, { leadId: "lead-x" }); // 3 forged ARFs from one lead: 1 complaint = 0.1 %
    await events(B, "ACCEPTED", 50, { at: ago(2 * H) });
    await events(B, "BOUNCE_HARD", 2, { leadId: "lead-y" }); // one lead, 2 DSNs: 1 / 50 = 2 %
    await events(B, "SEND_FAILED", 1, {
      leadId: "lead-y",
      meta: { error: "x", scope: "recipient" },
    });
    const i = await healthInputs(P(), [A.id, B.id], T);
    expect(i.get(A.id)).toMatchObject({ complaints30d: 1 });
    expect(i.get(B.id)).toMatchObject({ hard7d: 1 });
    expect(await evaluateHealth(P(), fixedClock(T))).toMatchObject({ throttled: 0, paused: 0 });
    for (const x of [A, B]) expect(await acct(x.id)).toMatchObject({ lifecycle: "ACTIVE" });
  });

  test("A-8: an unchanged account row and snapshot are not rewritten", async () => {
    const s = await seedCampaign(P(), { at: T, accounts: [{}] });
    const A = s.accounts[0]!;
    await events(A, "ACCEPTED", 100);
    await events(A, "BOUNCE_SOFT", 3);
    const xmin = async () => {
      const [a] = await P().$queryRaw<
        { x: string }[]
      >`SELECT xmin::text AS x FROM "EmailAccount" WHERE id = ${A.id}`;
      const [h] = await P().$queryRaw<
        { x: string }[]
      >`SELECT xmin::text AS x FROM "HealthSnapshot" WHERE "accountId" = ${A.id}`;
      return [a!.x, h!.x];
    };
    const clock = fixedClock(T);
    await evaluateHealth(P(), clock);
    const before = await xmin();
    clock.advance(5 * 60_000);
    await evaluateHealth(P(), clock);
    expect(await xmin()).toEqual(before);
    await events(A, "BOUNCE_SOFT", 3); // the score changes: both are written
    clock.advance(5 * 60_000);
    await evaluateHealth(P(), clock);
    const after = await xmin();
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect((await acct(A.id)).healthScore).toBe(90);
  });
});

describe("evaluateHealth: campaigns", () => {
  const deps = {
    appUrl: "https://app.example.com",
    sendable: ["SMTP" as const],
    contentIssues: async () => [],
  };

  test("BounceProtect: campaign actions are isolated and conditional (Review Focus 4, M2, I3)", async () => {
    const X = await seedCampaign(P(), { at: T });
    const [A, B] = X.accounts as [EmailAccount, EmailAccount];
    const Y = await seedCampaign(P(), { at: T, workspaceId: X.ws, useAccounts: [A, B] });
    const send = async (a: EmailAccount, campaignId: string, accepted: number, hard: number) => {
      await events(a, "ACCEPTED", accepted, { campaignId });
      await events(a, "BOUNCE_HARD", hard, { campaignId });
    };
    // X 60 / 2 hard (3.3 %), Y 40 / 1 hard: A 67 / 2 (2.99 %), B 33 / 1 (3.03 %, below the 50-send pause floor)
    await send(A, X.campaign.id, 40, 1);
    await send(B, X.campaign.id, 20, 1);
    await send(A, Y.campaign.id, 27, 1);
    await send(B, Y.campaign.id, 13, 0);
    // the same 60 / 2 in a campaign with bounceProtect off and in a user-PAUSED one (30 / 1 per account: no pause)
    const off = await seedCampaign(P(), { at: T, campaign: { bounceProtect: false } });
    const paused = await seedCampaign(P(), { at: T, campaign: { status: "PAUSED" } });
    for (const c of [off, paused]) for (const a of c.accounts) await send(a, c.campaign.id, 30, 1);

    const clock = fixedClock(T);
    expect(await evaluateHealth(P(), clock)).toMatchObject({
      throttled: 6,
      paused: 0,
      bounceProtected: 1,
    });
    expect((await camp(X.campaign.id)).status).toBe("BOUNCE_PROTECT");
    expect((await camp(Y.campaign.id)).status).toBe("ACTIVE"); // 40 < 50 sends
    expect((await camp(off.campaign.id)).status).toBe("ACTIVE");
    expect((await camp(paused.campaign.id)).status).toBe("PAUSED");
    for (const a of [A, B]) expect(await acct(a.id)).toMatchObject({ lifecycle: "ACTIVE" });
    expect((await acct(A.id)).healthCap).not.toBeNull();
    expect((await acct(B.id)).healthCap).not.toBeNull();
    expect(await audits("campaign.bounce_protect")).toMatchObject([
      { target: X.campaign.id, meta: { accepted24h: 60, hard24h: 2 } },
    ]);

    clock.advance(5 * 60_000); // never auto-resumes
    await evaluateHealth(P(), clock);
    expect((await camp(X.campaign.id)).status).toBe("BOUNCE_PROTECT");

    // I3: the user resumes; the same bounces do not protect it again
    await resumeCampaign(P(), clock, deps, X.ws, X.campaign.id, null);
    expect(await camp(X.campaign.id)).toMatchObject({
      status: "ACTIVE",
      bounceProtectResetAt: clock.now(),
    });
    clock.advance(5 * 60_000);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ bounceProtected: 0 });
    expect((await camp(X.campaign.id)).status).toBe("ACTIVE");
  });

  test("ACCOUNTS_UNHEALTHY when no assigned account can send, back to ACTIVE when one can; staleness never counts", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{ lifecycle: "PAUSED" }, { lifecycle: "PAUSED" }],
    });
    const stale = await seedCampaign(P(), {
      at: T,
      accounts: [{ lastSyncCompletedAt: ago(30 * 24 * H) }],
    });
    const clock = fixedClock(T);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ unhealthy: 1, recovered: 0 });
    expect((await camp(s.campaign.id)).status).toBe("ACCOUNTS_UNHEALTHY");
    expect((await camp(stale.campaign.id)).status).toBe("ACTIVE");
    expect(await audits("campaign.accounts_unhealthy")).toMatchObject([
      { target: s.campaign.id, meta: { status: "ACCOUNTS_UNHEALTHY", assigned: 2, sendable: 0 } },
    ]);

    await resumeAccount(P(), s.ws, s.accounts[0]!.id, { clock });
    clock.advance(5 * 60_000);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ unhealthy: 0, recovered: 1 });
    expect((await camp(s.campaign.id)).status).toBe("ACTIVE");
  });

  test("a recovering campaign is checked by BounceProtect in the same run", async () => {
    const s = await seedCampaign(P(), { at: T, campaign: { status: "ACCOUNTS_UNHEALTHY" } });
    for (const a of s.accounts) {
      await events(a, "ACCEPTED", 30, { campaignId: s.campaign.id });
      await events(a, "BOUNCE_HARD", 2, { campaignId: s.campaign.id });
    }
    expect(await evaluateHealth(P(), fixedClock(T))).toMatchObject({
      recovered: 1,
      bounceProtected: 1,
    });
    expect((await camp(s.campaign.id)).status).toBe("BOUNCE_PROTECT");
  });

  test("A-1: BounceProtect counts one lead once and needs 50 sends for the complaint branch too", async () => {
    const dup = await seedCampaign(P(), { at: T });
    const few = await seedCampaign(P(), { at: T });
    const many = await seedCampaign(P(), { at: T });
    const [D] = dup.accounts as [EmailAccount];
    const [F] = few.accounts as [EmailAccount];
    const [M] = many.accounts as [EmailAccount];
    // 60 sends, 2 hard bounces and 2 complaints, all from one lead: 1.7 % hard, 0.1 % complaints
    await events(D, "ACCEPTED", 60, { campaignId: dup.campaign.id });
    await events(D, "BOUNCE_HARD", 2, { campaignId: dup.campaign.id, leadId: "l1" });
    await events(D, "COMPLAINT", 2, { campaignId: dup.campaign.id, leadId: "l1" });
    // 5 sends, 2 complaints from 2 leads: below the 50-send floor
    await events(F, "ACCEPTED", 5, { campaignId: few.campaign.id });
    await events(F, "COMPLAINT", 1, { campaignId: few.campaign.id, leadId: "l2" });
    await events(F, "COMPLAINT", 1, { campaignId: few.campaign.id, leadId: "l3" });
    // 60 sends, 2 complaints from 2 leads: protected
    await events(M, "ACCEPTED", 60, { campaignId: many.campaign.id });
    await events(M, "COMPLAINT", 1, { campaignId: many.campaign.id, leadId: "l4" });
    await events(M, "COMPLAINT", 1, { campaignId: many.campaign.id, leadId: "l5" });
    expect(await evaluateHealth(P(), fixedClock(T))).toMatchObject({ bounceProtected: 1 });
    expect((await camp(dup.campaign.id)).status).toBe("ACTIVE");
    expect((await camp(few.campaign.id)).status).toBe("ACTIVE");
    expect((await camp(many.campaign.id)).status).toBe("BOUNCE_PROTECT");
  });

  test("D51: the BounceProtect complaint floor counts the 30-day sends, the window of complaint%", async () => {
    const quiet = await seedCampaign(P(), { at: T });
    const busy = await seedCampaign(P(), { at: T });
    const [Q] = quiet.accounts as [EmailAccount];
    const [B] = busy.accounts as [EmailAccount];
    // a quiet last day (10 sends) after 1990 earlier in the month, 3 complaints: 0.15 % of 2000 > 0.1 %
    for (const [a, c, day] of [
      [Q, quiet.campaign.id, 10],
      [B, busy.campaign.id, 60],
    ] as const) {
      await events(a, "ACCEPTED", day, { campaignId: c });
      await events(a, "ACCEPTED", 2000 - day, { campaignId: c, at: ago(5 * 24 * H) });
      for (const l of ["a", "b", "c"])
        await events(a, "COMPLAINT", 1, { campaignId: c, leadId: `${c}${l}` });
    }
    expect(await evaluateHealth(P(), fixedClock(T))).toMatchObject({ bounceProtected: 2 });
    expect((await camp(quiet.campaign.id)).status).toBe("BOUNCE_PROTECT");
    expect((await camp(busy.campaign.id)).status).toBe("BOUNCE_PROTECT");
  });

  test("G-M7: a failing step does not skip the later ones", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      accounts: [{ lifecycle: "PAUSED" }, { lifecycle: "PAUSED" }],
    });
    // BounceProtect's query fails; the ACTIVE → ACCOUNTS_UNHEALTHY flip after it still runs
    const real = P();
    const faulty = new Proxy(real, {
      get(t, k) {
        const v = Reflect.get(t, k);
        if (k === "$queryRaw")
          return (q: TemplateStringsArray, ...xs: unknown[]) =>
            q.join("").includes('bounceThresholdPct" AS thr')
              ? Promise.reject(new Error("boom"))
              : v.call(t, q, ...xs);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await evaluateHealth(faulty, fixedClock(T))).toMatchObject({
        bounceProtected: 0,
        unhealthy: 1,
      });
      expect(err).toHaveBeenCalledWith(expect.stringContaining("bounceProtect"), expect.any(Error));
    } finally {
      err.mockRestore();
    }
    expect((await camp(s.campaign.id)).status).toBe("ACCOUNTS_UNHEALTHY");
  });
});
