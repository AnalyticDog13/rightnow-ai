import type { EmailAccount, Prisma } from "@rightnow/db/client";
import { maxDailyLimit } from "./accounts/factory";

type Tx = Prisma.TransactionClient;

/**
 * Sends an account may make today: min(user limit, re-warm, health, floor(providerCap/2)). Never negative.
 * The ramp term (slowRamp) is added by P3-T13; the fields are already in the signature.
 */
export function effectiveAllowance(
  a: Pick<
    EmailAccount,
    | "dailyLimit"
    | "providerCap"
    | "slowRamp"
    | "rampStartVolume"
    | "rampIncrementPerDay"
    | "rampStartedAt"
    | "createdAt"
    | "timezone"
  >,
  _now: Date,
  ctx: { rewarmAllowance?: number | null; healthThrottle?: number | null } = {},
): number {
  const terms = [
    a.dailyLimit,
    maxDailyLimit(a.providerCap),
    ctx.rewarmAllowance,
    ctx.healthThrottle,
  ];
  return Math.max(0, Math.min(...terms.filter((t): t is number => typeof t === "number")));
}

/** A claimed reservation: the units and the three stored usage days (YYYY-MM-DD) it was booked on. */
export type UsageRef = {
  accountId: string;
  campaignId: string;
  workspaceId: string;
  usageDay: string;
  campUsageDay: string;
  wsUsageDay: string;
  reservedUnits: number;
};

// Always by the stored day keys, never "today": a send that completes after midnight is credited to its claim day.
// Lock order D21: ScheduledMessage -> CampaignLead -> AccountDailyUsage -> CampaignDailyUsage -> WorkspaceDailyUsage.
async function apply(tx: Tx, r: UsageRef, reserved: "keep" | "release", sent: boolean) {
  const u = r.reservedUnits;
  const res = reserved === "release" ? u : 0;
  const s = sent ? u : 0;
  await tx.$executeRaw`UPDATE "AccountDailyUsage" SET reserved = GREATEST(reserved - ${res}::int, 0), sent = sent + ${s}::int
    WHERE "accountId" = ${r.accountId} AND day = ${r.usageDay}::date`;
  await tx.$executeRaw`UPDATE "CampaignDailyUsage" SET reserved = GREATEST(reserved - ${res}::int, 0), sent = sent + ${s}::int
    WHERE "campaignId" = ${r.campaignId} AND day = ${r.campUsageDay}::date`;
  await tx.$executeRaw`UPDATE "WorkspaceDailyUsage" SET reserved = GREATEST(reserved - ${res}::int, 0), sent = sent + ${s}::int
    WHERE "workspaceId" = ${r.workspaceId} AND day = ${r.wsUsageDay}::date`;
}

/** Accepted send: reserved -= u, sent += u on the stored days. */
export const commitUsage = (tx: Tx, r: UsageRef) => apply(tx, r, "release", true);
/** Send did not happen: reserved = GREATEST(reserved - u, 0). */
export const releaseUsage = (tx: Tx, r: UsageRef) => apply(tx, r, "release", false);
/** Late accept after the reservation was already released: sent += u only. */
export const creditSent = (tx: Tx, r: UsageRef) => apply(tx, r, "keep", true);
