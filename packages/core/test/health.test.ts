import { randomBytes } from "node:crypto";
import type { EmailAccount, EventType, Prisma } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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

/** `n` events of `type` for an account (and campaign), at `at` (default an hour before T). */
async function events(
  a: Pick<EmailAccount, "id" | "workspaceId">,
  type: EventType,
  n: number,
  o: { at?: Date; campaignId?: string; meta?: Prisma.InputJsonObject } = {},
) {
  await P().event.createMany({
    data: Array.from({ length: n }, () => ({
      workspaceId: a.workspaceId,
      type,
      occurredAt: o.at ?? ago(H),
      accountId: a.id,
      campaignId: o.campaignId ?? null,
      meta: o.meta ?? {},
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
      { target: s.campaign.id, meta: { status: "ACCOUNTS_UNHEALTHY" } },
    ]);

    await resumeAccount(P(), s.ws, s.accounts[0]!.id, { clock });
    clock.advance(5 * 60_000);
    expect(await evaluateHealth(P(), clock)).toMatchObject({ unhealthy: 0, recovered: 1 });
    expect((await camp(s.campaign.id)).status).toBe("ACTIVE");
  });
});
