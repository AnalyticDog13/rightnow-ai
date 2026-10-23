import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount, Prisma } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { openAccount } from "../src/accounts/open-account";
import { fixedClock } from "../src/clock";
import { evaluateHealth } from "../src/deliverability/health";
import {
  cancelRewarm,
  completeRewarms,
  rewarmPlanView,
  startRewarm,
} from "../src/deliverability/rewarm";
import { updateWarmup } from "../src/deliverability/warmup-settings";
import { effectiveAllowance } from "../src/quota";
import { seedCampaign } from "./campaign-fixture";
import { fakeResolver } from "./dns-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "rewarm-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(T.getTime() - d * DAY);
const clock = () => fixedClock(T);
const acct = (id: string) => P().emailAccount.findUniqueOrThrow({ where: { id } });
const warm = (id: string) => P().warmupSettings.findUnique({ where: { accountId: id } });
const audits = (target: string, action: string) =>
  P().auditLog.count({ where: { target, action } });

// SMTP account on send.test: SPF present (DKIM, DMARC, MX missing = warnings); `{}` = no SPF = block
const okDns = fakeResolver({ "send.test/TXT": [["v=spf1 ip4:192.0.2.1 -all"]] });
const deps = (resolver = okDns) => ({
  providerFor: async (a: EmailAccount) => getFakeProvider(a.email),
  resolver,
});

let n = 0;
async function setup(account: Partial<Prisma.EmailAccountUncheckedCreateInput> = {}) {
  const s = await seedCampaign(P(), {
    at: T,
    workspace: { autoRewarm: "RECOMMEND", inactivityDays: 30 },
    accounts: [
      {
        email: `rw${++n}-${randomBytes(2).toString("hex")}@send.test`,
        credentialsEnc: "x",
        dailyLimit: 30,
        createdAt: ago(90),
        lastSentAt: ago(40),
        lifecycle: "INACTIVE",
        ...account,
      },
    ],
  });
  return { ws: s.ws, A: s.accounts[0]! };
}
/** A plan whose allowance already reached its target (5 + 2 x 13 ≥ 30), started 20 days ago. */
const reached = {
  lifecycle: "REWARMING" as const,
  rewarmStartedAt: ago(20),
  rewarmTarget: 30,
  rewarmSendDays: 13,
  rewarmLastSendDay: ago(1),
  rewarmPrevious: { warmupEnabled: false, setTo: false },
};

describe("startRewarm", () => {
  test("INACTIVE → REWARMING at 5/day, audited, DNS warnings returned", async () => {
    const { ws, A } = await setup();
    const r = await startRewarm(P(), clock(), deps(), ws, "u1", A.id, {});
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.every((w) => w.level === "warn")).toBe(true);
    const a = await acct(A.id);
    expect(a).toMatchObject({
      lifecycle: "REWARMING",
      rewarmStartedAt: T,
      rewarmTarget: 30,
      rewarmStartVolume: 5,
      rewarmIncrementPerDay: 2,
      dailyLimit: 30,
    });
    expect(effectiveAllowance(a, T)).toBe(5);
    expect(await audits(A.id, "account.rewarm_start")).toBe(1);
  });

  test("start volume and increment are the user's", async () => {
    const { ws, A } = await setup({ lifecycle: "ACTIVE" });
    await startRewarm(P(), clock(), deps(), ws, "u1", A.id, { startVolume: 3, incrementPerDay: 4 });
    expect(await acct(A.id)).toMatchObject({ rewarmStartVolume: 3, rewarmIncrementPerDay: 4 });
  });

  test("SPF missing → 409 rewarm_blocked with the reasons, nothing changed", async () => {
    const { ws, A } = await setup();
    const e = await startRewarm(P(), clock(), deps(fakeResolver({})), ws, "u1", A.id, {}).catch(
      (x) => x,
    );
    expect(e).toMatchObject({ status: 409, message: "rewarm_blocked" });
    expect((e.body as { issues: { level: string }[] }).issues[0]!.level).toBe("block");
    expect(await acct(A.id)).toMatchObject({ lifecycle: "INACTIVE", rewarmStartedAt: null });
    expect(await audits(A.id, "account.rewarm_start")).toBe(0);
  });

  test("revoked auth on the connectivity check → 409 reconnect_required, account NEEDS_ATTENTION", async () => {
    const { ws, A } = await setup();
    getFakeProvider(A.email).failNext("auth_revoked");
    const e = await startRewarm(P(), clock(), deps(), ws, "u1", A.id, {}).catch((x) => x);
    getFakeProvider(A.email).clearFailures();
    expect(e).toMatchObject({ status: 409, message: "reconnect_required" });
    expect((e.body as { checks: { ok: boolean }[] }).checks.some((c) => !c.ok)).toBe(true);
    expect(await acct(A.id)).toMatchObject({
      id: A.id,
      lifecycle: "NEEDS_ATTENTION",
      rewarmStartedAt: null,
    });
  });

  test("a second start → 409; paused or foreign → 409 / 404", async () => {
    const { ws, A } = await setup();
    await startRewarm(P(), clock(), deps(), ws, "u1", A.id, {});
    await expect(startRewarm(P(), clock(), deps(), ws, "u1", A.id, {})).rejects.toMatchObject({
      status: 409,
      message: "cannot_rewarm_rewarming",
    });
    const p = await setup({ lifecycle: "PAUSED" });
    await expect(startRewarm(P(), clock(), deps(), p.ws, "u1", p.A.id, {})).rejects.toMatchObject({
      status: 409,
      message: "cannot_rewarm_paused",
    });
    await expect(startRewarm(P(), clock(), deps(), p.ws, "u1", A.id, {})).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("warm-up during re-warm (PS-REWARM-11, M12)", () => {
  test("withWarmup enables warm-up; completion restores it to disabled", async () => {
    const { ws, A } = await setup();
    await startRewarm(P(), clock(), deps(), ws, "u1", A.id, { withWarmup: true });
    expect(await warm(A.id)).toMatchObject({ enabled: true, startedAt: T });
    expect((await acct(A.id)).rewarmPrevious).toEqual({ warmupEnabled: false, setTo: true });
    await P().emailAccount.update({
      where: { id: A.id },
      data: { rewarmSendDays: 13, rewarmLastSendDay: ago(1) },
    });
    expect(await completeRewarms(P(), clock())).toBe(1);
    expect((await warm(A.id))!.enabled).toBe(false);
  });

  test("the user disables warm-up mid-plan → stays disabled, completion writes nothing to it", async () => {
    const { ws, A } = await setup();
    await startRewarm(P(), clock(), deps(), ws, "u1", A.id, { withWarmup: true });
    await updateWarmup(P(), await acct(A.id), { enabled: false }, { clock: clock() });
    const before = (await warm(A.id))!.updatedAt;
    await P().emailAccount.update({
      where: { id: A.id },
      data: { rewarmSendDays: 13, rewarmLastSendDay: ago(1) },
    });
    expect(await completeRewarms(P(), clock())).toBe(1);
    expect(await warm(A.id)).toMatchObject({ enabled: false, updatedAt: before });
  });

  test("warm-up already on stays on after the plan", async () => {
    const { ws, A } = await setup();
    await updateWarmup(P(), A, { enabled: true }, { clock: clock() });
    await startRewarm(P(), clock(), deps(), ws, "u1", A.id, { withWarmup: true });
    expect((await acct(A.id)).rewarmPrevious).toEqual({ warmupEnabled: true, setTo: true });
    await cancelRewarm(P(), clock(), ws, "u1", A.id);
    expect((await warm(A.id))!.enabled).toBe(true);
  });
});

describe("cancelRewarm", () => {
  test("restores warm-up, ends the plan as ACTIVE with the idle clock reset, audited; no plan → 409", async () => {
    const { ws, A } = await setup();
    await startRewarm(P(), clock(), deps(), ws, "u1", A.id, { withWarmup: true });
    await cancelRewarm(P(), clock(), ws, "u1", A.id);
    expect(await acct(A.id)).toMatchObject({
      lifecycle: "ACTIVE",
      rewarmStartedAt: null,
      rewarmTarget: null,
      rewarmSendDays: 0,
      rewarmPrevious: null,
      activityResetAt: T,
    });
    expect((await warm(A.id))!.enabled).toBe(false);
    expect(await audits(A.id, "account.rewarm_cancel")).toBe(1);
    await expect(cancelRewarm(P(), clock(), ws, "u1", A.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  test("a paused re-warming account stays paused, without the plan", async () => {
    const { ws, A } = await setup({ ...reached, lifecycle: "PAUSED" });
    await cancelRewarm(P(), clock(), ws, "u1", A.id);
    expect(await acct(A.id)).toMatchObject({ lifecycle: "PAUSED", rewarmStartedAt: null });
  });
});

describe("completeRewarms (PS-REWARM-08)", () => {
  async function events(a: EmailAccount, type: "ACCEPTED" | "BOUNCE_HARD", k: number, at: Date) {
    await P().event.createMany({
      data: Array.from({ length: k }, () => ({
        workspaceId: a.workspaceId,
        accountId: a.id,
        type,
        occurredAt: at,
        meta: {},
        scheduledMessageId: `sm-${randomBytes(4).toString("hex")}`,
        dedupeKey: `t:${randomBytes(8).toString("hex")}`,
      })),
    });
  }

  test("target reached, no cap, clean days → ACTIVE at dailyLimit, plan cleared, audited", async () => {
    const { A } = await setup(reached);
    await events(A, "ACCEPTED", 30, ago(1));
    const r = await evaluateHealth(P(), clock());
    expect(r.rewarmsCompleted).toBe(1);
    const a = await acct(A.id);
    expect(a).toMatchObject({
      lifecycle: "ACTIVE",
      rewarmStartedAt: null,
      rewarmPrevious: null,
      activityResetAt: T,
    });
    expect(effectiveAllowance(a, T)).toBe(30);
    expect(await audits(A.id, "account.rewarm_complete")).toBe(1);
  });

  test.each([
    ["below target", { rewarmSendDays: 5 }],
    ["health cap", { healthCap: 10, healthCapAt: ago(0.1) }],
    ["recent error", { lastErrorAt: ago(2) }],
  ])("%s → keeps re-warming", async (_, extra) => {
    const { A } = await setup({ ...reached, ...extra });
    expect(await completeRewarms(P(), clock())).toBe(0);
    expect((await acct(A.id)).lifecycle).toBe("REWARMING");
  });

  test("hard bounces above 2 % in the clean window → keeps re-warming; older ones do not count", async () => {
    const dirty = (await setup(reached)).A;
    await events(dirty, "ACCEPTED", 40, ago(1));
    await events(dirty, "BOUNCE_HARD", 1, ago(1)); // 1 / 40 = 2.5 %
    const old = (await setup(reached)).A;
    await events(old, "ACCEPTED", 40, ago(1));
    await events(old, "BOUNCE_HARD", 3, ago(4));
    await completeRewarms(P(), clock());
    expect((await acct(dirty.id)).lifecycle).toBe("REWARMING");
    expect((await acct(old.id)).lifecycle).toBe("ACTIVE");
  });
});

describe("rewarmPlanView", () => {
  test("allowance, target, progress and days left; null without a plan", () => {
    const a = {
      dailyLimit: 30,
      timezone: "UTC",
      rewarmStartedAt: ago(5),
      rewarmStartVolume: 5,
      rewarmIncrementPerDay: 2,
      rewarmTarget: 30,
      rewarmSendDays: 3,
      rewarmLastSendDay: ago(1),
    } as EmailAccount;
    expect(rewarmPlanView(a, T)).toEqual({
      allowance: 11,
      target: 30,
      progressPct: 37,
      estimatedDaysLeft: 10,
      label: "configurable plan, not a guaranteed reputation recovery timeline",
    });
    expect(rewarmPlanView({ ...a, rewarmStartedAt: null }, T)).toBeNull();
  });
});

describe("revival (T05 review Minor 2)", () => {
  test("a deleted mid-plan account comes back without its old plan or health cap", async () => {
    const { ws, A } = await setup({
      ...reached,
      rewarmSendDays: 6,
      healthCap: 4,
      healthCapAt: ago(25),
      lastSentAt: ago(60),
    });
    await P().emailAccount.update({
      where: { id: A.id },
      data: { deletedAt: ago(50), status: "DISCONNECTED", credentialsEnc: null },
    });
    await P().workspace.update({ where: { id: ws }, data: { autoRewarm: "AUTO" } });
    const id = await P().$transaction((tx) =>
      openAccount(tx, clock(), ws, {
        provider: "SMTP",
        email: A.email,
        capTier: "SMTP",
        providerCap: 100,
        appendToSent: true,
        fromName: "S",
        firstName: "S",
        lastName: "T",
      }),
    );
    expect(id).toBe(A.id);
    const a = await acct(A.id);
    // idle 60 days: a fresh plan from today, not step 6 of the old one
    expect(a).toMatchObject({
      lifecycle: "REWARMING",
      rewarmStartedAt: T,
      rewarmSendDays: 0,
      rewarmLastSendDay: null,
      healthCap: null,
      healthCapAt: null,
    });
    expect(effectiveAllowance(a, T)).toBe(5);
  });
});
