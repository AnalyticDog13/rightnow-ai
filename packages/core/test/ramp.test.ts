import { createTestDb } from "@rightnow/db/test-db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { claimDue, type ClaimOpts } from "../src/dispatch";
import { effectiveAllowance } from "../src/quota";
import { toApiAccount } from "../src/accounts/serialize";
import { updateAccount } from "../src/accounts/service";
import { updateWorkspaceSettings, getWorkspaceSettings } from "../src/settings";
import { markFresh, seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const opts = (o: Partial<ClaimOpts> = {}): ClaimOpts => ({
  limit: 50,
  bootId: "b",
  stalenessSec: 300,
  sendableProviders: ["SMTP"],
  ...o,
});
const acct = {
  dailyLimit: 30,
  providerCap: 100,
  slowRamp: true,
  rampStartVolume: 2,
  rampIncrementPerDay: 2,
  rampStartedAt: null,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  timezone: "UTC",
};

describe("ramp term", () => {
  test.each([
    ["2026-10-20T10:00:00Z", 2],
    ["2026-10-23T10:00:00Z", 8],
    ["2026-11-10T10:00:00Z", 30],
  ])("%s -> %i", (at, want) => expect(effectiveAllowance(acct, new Date(at))).toBe(want));

  test("off -> user limit; rampStartedAt wins over createdAt; day count follows the account timezone", () => {
    expect(effectiveAllowance({ ...acct, slowRamp: false }, T)).toBe(30);
    expect(
      effectiveAllowance({ ...acct, rampStartedAt: new Date("2026-10-18T10:00:00Z") }, T),
    ).toBe(6);
    // 2026-10-20T20:00Z is already 10-21 in Auckland: one local day after the start
    expect(
      effectiveAllowance(
        { ...acct, timezone: "Pacific/Auckland" },
        new Date("2026-10-20T20:00:00Z"),
      ),
    ).toBe(4);
  });

  test("the claim honors it: 2 on day 0, 4 on day 1", async () => {
    const s = await seedCampaign(db.prisma, {
      at: T,
      rows: 10,
      accounts: [{ slowRamp: true, dailyLimit: 30, createdAt: new Date("2026-10-20T00:00:00Z") }],
    });
    expect(await claimDue(db.prisma, fixedClock(T), opts())).toHaveLength(2);
    const d1 = new Date("2026-10-21T10:00:00Z");
    await markFresh(db.prisma, [s.accounts[0]!.id], d1);
    expect(await claimDue(db.prisma, fixedClock(d1), opts())).toHaveLength(4);
  });

  test("toApiAccount.remainingToday uses the ramp value", async () => {
    const [a] = (
      await seedCampaign(db.prisma, {
        at: T,
        accounts: [{ slowRamp: true, dailyLimit: 30, createdAt: acct.createdAt }],
      })
    ).accounts;
    expect(toApiAccount(a!, { sent: 1, reserved: 0 }, T).remainingToday).toBe(1);
  });

  test("updateAccount({slowRamp:true}) stamps rampStartedAt once", async () => {
    const [a] = (await seedCampaign(db.prisma, { at: T, accounts: [{}] })).accounts;
    const at = new Date("2026-10-22T00:00:00Z");
    const on = await updateAccount(
      db.prisma,
      a!.workspaceId,
      a!.id,
      { slowRamp: true },
      { clock: fixedClock(at) },
    );
    expect(on.account.rampStartedAt).toEqual(at);
    await updateAccount(
      db.prisma,
      a!.workspaceId,
      a!.id,
      { slowRamp: false },
      { clock: fixedClock(T) },
    );
    const again = await updateAccount(
      db.prisma,
      a!.workspaceId,
      a!.id,
      { slowRamp: true },
      { clock: fixedClock(T) },
    );
    expect(again.account.rampStartedAt).toEqual(at);
  });
});

describe("workspace cap settings", () => {
  const clock = fixedClock(T);
  test("dailyCap 0 -> 400; 100 stored; null clears; flags stored", async () => {
    const s = await seedCampaign(db.prisma, { at: T });
    const up = (i: unknown) => updateWorkspaceSettings(db.prisma, clock, s.ws, null, i);
    await expect(up({ dailyCap: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(up({ perCompanyDailyLimit: -1 })).rejects.toMatchObject({ status: 400 });
    expect(
      await up({
        dailyCap: 100,
        perCompanyDailyLimit: 3,
        disableOpenTracking: true,
        firstEmailTextOnly: true,
      }),
    ).toMatchObject({
      dailyCap: 100,
      perCompanyDailyLimit: 3,
      disableOpenTracking: true,
      firstEmailTextOnly: true,
    });
    expect((await up({ dailyCap: null })).dailyCap).toBeNull();
    expect((await getWorkspaceSettings(db.prisma, s.ws)).perCompanyDailyLimit).toBe(3);
  });

  test("the claim honors the API value", async () => {
    const s = await seedCampaign(db.prisma, { at: T, rows: 4 });
    await updateWorkspaceSettings(db.prisma, fixedClock(T), s.ws, null, { dailyCap: 2 });
    expect(await claimDue(db.prisma, fixedClock(T), opts())).toHaveLength(2);
  });
});
