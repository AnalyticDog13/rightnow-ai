import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount, Prisma } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { markFixed } from "../src/accounts/diagnostics";
import { AccountError, pauseAccount, resumeAccount } from "../src/accounts/service";
import { fixedClock } from "../src/clock";
import { claimDue, type ClaimOpts } from "../src/dispatch";
import {
  computeLifecycle,
  idleSince,
  resumeFullVolume,
  returnToService,
} from "../src/deliverability/lifecycle";
import { whyNotSending } from "../src/explain";
import { reconcileAccount, type SyncDeps } from "../src/mail/sync";
import { effectiveAllowance } from "../src/quota";
import { dispatchTick } from "../src/sender";
import { unsubscribeKeys } from "../src/unsubscribe";
import { seedCampaign } from "./campaign-fixture";

// `watermark and lifecycle commit together` makes the sync's computeLifecycle throw once
const fail = vi.hoisted(() => ({ once: false }));
vi.mock("../src/deliverability/lifecycle", async (orig) => {
  const m = await orig<typeof import("../src/deliverability/lifecycle")>();
  return {
    ...m,
    computeLifecycle: (...a: Parameters<typeof m.computeLifecycle>) => {
      if (fail.once) {
        fail.once = false;
        throw new Error("boom");
      }
      return m.computeLifecycle(...a);
    },
  };
});

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "lifecycle-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());
afterEach(() => void vi.restoreAllMocks());

const T = new Date("2026-10-20T10:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(T.getTime() - d * DAY);
const LOOK = { lookaheadSec: 300 };
const fake = (a: { email: string }) => getFakeProvider(a.email);
const env = {
  appUrl: "https://app.example.com",
  unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") }),
};
const claimOpts = (o: Partial<ClaimOpts> = {}): ClaimOpts => ({
  limit: 50,
  bootId: "b",
  stalenessSec: 300,
  sendableProviders: ["SMTP"],
  env,
  ...o,
});
const syncDeps: SyncDeps = {
  providerFor: async (a) => fake(a),
  env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
};
const acct = (id: string) => P().emailAccount.findUniqueOrThrow({ where: { id } });
const compute = (id: string, at = T, o = LOOK) =>
  P().$transaction((tx) => computeLifecycle(tx, fixedClock(at), id, o));

let n = 0;
/** One live SMTP account (dailyLimit 30, created 45 d ago, last campaign send `idle` days ago) in a sendable campaign. */
async function setup(
  o: {
    idle?: number;
    autoRewarm?: "OFF" | "RECOMMEND" | "AUTO";
    account?: Partial<Prisma.EmailAccountUncheckedCreateInput>;
    rows?: number;
  } = {},
) {
  const s = await seedCampaign(P(), {
    at: T,
    rows: o.rows ?? 0,
    workspace: { autoRewarm: o.autoRewarm ?? "AUTO", inactivityDays: 30 },
    accounts: [
      {
        email: `life${++n}@send.test`,
        credentialsEnc: "x",
        dailyLimit: 30,
        createdAt: ago(45),
        lastSentAt: o.idle === undefined ? ago(31) : ago(o.idle),
        ...o.account,
      },
    ],
  });
  return { ...s, A: s.accounts[0]! as EmailAccount };
}

describe("effectiveAllowance re-warm term", () => {
  const base = {
    dailyLimit: 30,
    providerCap: 100,
    slowRamp: false,
    rampStartVolume: 1,
    rampIncrementPerDay: 1,
    rampStartedAt: null,
    createdAt: ago(100),
    timezone: "UTC",
    healthCap: null,
    rewarmStartedAt: new Date("2026-10-20T08:00:00Z"),
    rewarmStartVolume: 5,
    rewarmIncrementPerDay: 2,
    rewarmTarget: 30,
    rewarmSendDays: 0,
    rewarmLastSendDay: null,
  };
  const day = (d: string) => new Date(`${d}T12:00:00Z`);
  const sent3 = { rewarmSendDays: 3, rewarmLastSendDay: new Date("2026-10-23T00:00:00Z") };

  test("day 0 → 5; sends on 3 local days → 11; today's send and idle days do not count", () => {
    expect(effectiveAllowance(base, T)).toBe(5);
    expect(effectiveAllowance({ ...base, ...sent3 }, day("2026-10-24"))).toBe(11);
    expect(effectiveAllowance({ ...base, ...sent3 }, day("2026-10-23"))).toBe(9); // 3rd day still running
    expect(effectiveAllowance({ ...base, ...sent3 }, day("2026-11-10"))).toBe(11); // no sends since
  });

  test("capped by target, dailyLimit and healthCap; never negative; no plan → no term", () => {
    expect(effectiveAllowance({ ...base, rewarmSendDays: 40 }, T)).toBe(30);
    expect(effectiveAllowance({ ...base, rewarmSendDays: 40, dailyLimit: 8 }, T)).toBe(8);
    expect(effectiveAllowance({ ...base, ...sent3, healthCap: 3 }, day("2026-10-24"))).toBe(3);
    expect(
      effectiveAllowance({ ...base, rewarmLastSendDay: new Date("2026-10-20T00:00:00Z") }, T),
    ).toBe(5);
    expect(effectiveAllowance({ ...base, healthCap: 0 }, T)).toBe(0);
    expect(effectiveAllowance({ ...base, rewarmStartedAt: null }, T)).toBe(30);
  });
});

describe("ramp under real sends", () => {
  const sendAt = async (A: EmailAccount, at: Date) => {
    await P().emailAccount.update({ where: { id: A.id }, data: { lastSyncCompletedAt: at } });
    return dispatchTick(P(), fixedClock(at), {
      providerFor: fake,
      env,
      random: () => 0,
      ...claimOpts({ sendableProviders: ["SMTP"] }),
      maxMs: 5_000,
    });
  };
  const rewarming = {
    lifecycle: "REWARMING" as const,
    rewarmStartedAt: ago(2),
    rewarmTarget: 30,
    rewarmSendDays: 1,
    rewarmLastSendDay: new Date("2026-10-19T00:00:00Z"),
  };

  test("the first send of a new local day counts once; a second send that day does not", async () => {
    const { A } = await setup({ idle: 1, rows: 2, account: rewarming });
    await sendAt(A, T);
    await sendAt(A, new Date(T.getTime() + 3600_000));
    expect(await P().scheduledMessage.count({ where: { accountId: A.id, status: "SENT" } })).toBe(2);
    expect(await acct(A.id)).toMatchObject({
      rewarmSendDays: 2,
      rewarmLastSendDay: new Date("2026-10-20T00:00:00Z"),
    });
  });

  test("ramp holds under health cap", async () => {
    const { A } = await setup({ idle: 1, rows: 1, account: { ...rewarming, healthCap: 3 } });
    await sendAt(A, T);
    expect(await P().scheduledMessage.count({ where: { accountId: A.id, status: "SENT" } })).toBe(1);
    expect(await acct(A.id)).toMatchObject({
      rewarmSendDays: 1,
      rewarmLastSendDay: new Date("2026-10-19T00:00:00Z"),
    });
  });
});

describe("computeLifecycle", () => {
  test("idle 31 d, AUTO → REWARMING with a plan and an audit row", async () => {
    const { A } = await setup();
    expect(await compute(A.id)).toBe("REWARMING");
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "REWARMING",
      rewarmStartedAt: T,
      rewarmTarget: 30,
      rewarmSendDays: 0,
      rewarmPrevious: { warmupEnabled: false },
    });
    expect(
      await P().auditLog.count({ where: { target: A.id, action: "account.inactive" } }),
    ).toBe(1);
    expect(effectiveAllowance(await acct(A.id), T)).toBe(5);
  });

  test("RECOMMEND → INACTIVE; OFF → unchanged; idle 29 d → unchanged", async () => {
    const r = (await setup({ autoRewarm: "RECOMMEND" })).A;
    expect(await compute(r.id)).toBe("INACTIVE");
    expect(await acct(r.id)).toMatchObject({ lifecycle: "INACTIVE", rewarmStartedAt: null });
    expect(await P().auditLog.count({ where: { target: r.id, action: "account.inactive" } })).toBe(1);
    const off = (await setup({ autoRewarm: "OFF", idle: 90 })).A;
    expect(await compute(off.id)).toBe("unchanged");
    const fresh = (await setup({ idle: 29 })).A;
    expect(await compute(fresh.id)).toBe("unchanged");
    expect((await acct(fresh.id)).lifecycle).toBe("ACTIVE");
  });

  test("DNS block + AUTO → INACTIVE", async () => {
    const { A, ws } = await setup();
    await P().domainCheck.create({
      data: { workspaceId: ws, domain: "send.test", checkedAt: T, level: "block", report: {} },
    });
    expect(await compute(A.id)).toBe("INACTIVE");
    expect(await acct(A.id)).toMatchObject({ lifecycle: "INACTIVE", rewarmStartedAt: null });
  });

  test.each(["REWARMING", "PAUSED", "NEEDS_ATTENTION", "INACTIVE"] as const)(
    "%s → unchanged",
    async (lifecycle) => {
      const { A } = await setup({ idle: 60, account: { lifecycle } });
      expect(await compute(A.id)).toBe("unchanged");
      expect((await acct(A.id)).lifecycle).toBe(lifecycle);
    },
  );

  test("warm-up is not activity (Rev 2 I6); a never-sent account idles from createdAt", async () => {
    const { A, ws } = await setup({ account: { lastWarmupAt: ago(2) } });
    await P().warmupSettings.create({
      data: { accountId: A.id, workspaceId: ws, enabled: true, filterTag: "wu" },
    });
    expect(await compute(A.id)).toBe("REWARMING");
    expect((await acct(A.id)).rewarmPrevious).toEqual({ warmupEnabled: true, setTo: true });
    const never = (await setup({ account: { lastSentAt: null, createdAt: ago(40) } })).A;
    expect(idleSince(never)).toEqual(ago(40));
    expect(await compute(never.id)).toBe("REWARMING");
  });

  test("look-ahead flags before the watermark goes stale", async () => {
    const { A } = await setup({
      autoRewarm: "RECOMMEND",
      account: { lastSentAt: new Date(ago(30).getTime() + 200_000) },
    });
    expect(await compute(A.id, T, { lookaheadSec: 100 })).toBe("unchanged");
    expect(await compute(A.id)).toBe("INACTIVE");
  });
});

describe("sync computes the lifecycle (D33)", () => {
  test("fresh implies lifecycle computed: AUTO claims 5, the 6th row waits for tomorrow", async () => {
    const { A } = await setup({ idle: 40, rows: 7, account: { lastSyncCompletedAt: null } });
    const clock = fixedClock(T);
    expect(await claimDue(P(), clock, claimOpts())).toHaveLength(0); // stale until the sync commits
    expect(await reconcileAccount(P(), clock, A.id, syncDeps)).toBe("caught_up");
    expect((await acct(A.id)).lifecycle).toBe("REWARMING");
    expect(await claimDue(P(), clock, claimOpts())).toHaveLength(5);
    const left = await P().scheduledMessage.findMany({
      where: { accountId: A.id, status: "SCHEDULED" },
    });
    expect(left).toHaveLength(2);
    for (const r of left) expect(r.dueAt >= new Date("2026-10-21T00:00:00Z")).toBe(true);
  });

  test("RECOMMEND: nothing claimed and the explainer says account_inactive", async () => {
    const { A, ws, campaign } = await setup({
      autoRewarm: "RECOMMEND",
      idle: 40,
      rows: 2,
      account: { lastSyncCompletedAt: null },
    });
    const clock = fixedClock(T);
    expect(await reconcileAccount(P(), clock, A.id, syncDeps)).toBe("caught_up");
    expect(await claimDue(P(), clock, claimOpts())).toHaveLength(0);
    const why = await whyNotSending(P(), clock, ws, campaign.id, {
      stalenessSec: 300,
      sendable: ["SMTP"],
    });
    const r = why.reasons.find((x) => x.code === "account_inactive");
    expect(r).toMatchObject({ blocking: true, accountIds: [A.id] });
    expect(r!.message).toMatch(/Re-warm.*Resume at full volume/);
  });

  test("watermark and lifecycle commit together", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { A } = await setup({ idle: 40, account: { lastSyncCompletedAt: null } });
    fail.once = true;
    expect(await reconcileAccount(P(), fixedClock(T), A.id, syncDeps)).toBe("failed");
    expect(await acct(A.id)).toMatchObject({ lastSyncCompletedAt: null, lifecycle: "ACTIVE" });
  });
});

describe("returnToService (Rev 2 I2)", () => {
  test("resume keeps re-warm: user pause and health pause → REWARMING", async () => {
    const { A, ws } = await setup({
      idle: 1,
      account: { lifecycle: "REWARMING", rewarmStartedAt: ago(3), rewarmTarget: 30 },
    });
    const clock = fixedClock(T);
    await pauseAccount(P(), ws, A.id, undefined, { clock });
    await resumeAccount(P(), ws, A.id, { clock });
    expect((await acct(A.id)).lifecycle).toBe("REWARMING");
    await P().emailAccount.update({
      where: { id: A.id },
      data: { lifecycle: "PAUSED", lastError: { kind: "SOFT_BOUNCE", code: "bounce_rate" } },
    });
    await resumeAccount(P(), ws, A.id, { clock });
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "REWARMING",
      lastError: null,
      healthResetAt: T,
    });
  });

  test.each([
    ["AUTO", 5],
    ["RECOMMEND", 0],
  ] as const)("paused 40 d, synced throughout, %s → resume → claim %i", async (mode, want) => {
    const { A, ws } = await setup({
      autoRewarm: mode,
      idle: 40,
      rows: 7,
      account: { lifecycle: "PAUSED" },
    });
    const clock = fixedClock(T);
    await resumeAccount(P(), ws, A.id, { clock });
    expect((await acct(A.id)).lifecycle).toBe(mode === "AUTO" ? "REWARMING" : "INACTIVE");
    expect(await claimDue(P(), clock, claimOpts())).toHaveLength(want);
  });

  test("INACTIVE → pause → resume → INACTIVE", async () => {
    const { A, ws } = await setup({ autoRewarm: "RECOMMEND", account: { lifecycle: "INACTIVE" } });
    const clock = fixedClock(T);
    await pauseAccount(P(), ws, A.id, undefined, { clock });
    await resumeAccount(P(), ws, A.id, { clock });
    expect((await acct(A.id)).lifecycle).toBe("INACTIVE");
  });

  test("REWARMING → NEEDS_ATTENTION → markFixed → REWARMING", async () => {
    const { A, ws } = await setup({
      idle: 1,
      account: { lifecycle: "NEEDS_ATTENTION", rewarmStartedAt: ago(3), rewarmTarget: 30 },
    });
    await markFixed(P(), ws, A.id, { clock: fixedClock(T), providerFor: fake });
    expect((await acct(A.id)).lifecycle).toBe("REWARMING");
  });

  test("a resume that lost a race to another state change writes nothing", async () => {
    const { A } = await setup({ idle: 1, account: { lifecycle: "PAUSED" } });
    await P().emailAccount.update({ where: { id: A.id }, data: { lifecycle: "NEEDS_ATTENTION" } });
    await P().$transaction((tx) => returnToService(tx, fixedClock(T), A, LOOK));
    expect((await acct(A.id)).lifecycle).toBe("NEEDS_ATTENTION");
  });
});

describe("resumeFullVolume", () => {
  test("INACTIVE → ACTIVE, activityResetAt = now, audited, not re-flagged on the next sync; 409 unless INACTIVE", async () => {
    const { A, ws } = await setup({ autoRewarm: "RECOMMEND", idle: 40, account: { lifecycle: "INACTIVE" } });
    const clock = fixedClock(T);
    await resumeFullVolume(P(), clock, ws, "u1", A.id);
    expect(await acct(A.id)).toMatchObject({ lifecycle: "ACTIVE", activityResetAt: T });
    expect(
      await P().auditLog.count({ where: { target: A.id, action: "account.resume_full" } }),
    ).toBe(1);
    expect(await reconcileAccount(P(), clock, A.id, syncDeps)).toBe("caught_up");
    expect((await acct(A.id)).lifecycle).toBe("ACTIVE");
    const err = await resumeFullVolume(P(), clock, ws, "u1", A.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountError);
    expect((err as AccountError).status).toBe(409);
    await expect(resumeFullVolume(P(), clock, "other-ws", "u1", A.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
