import type { EmailAccount, Prisma } from "@rightnow/db/client";
import { maxDailyLimit } from "./accounts/factory";
import { dayKey } from "./schedule";

type Tx = Prisma.TransactionClient;

type RewarmFields =
  | "healthCap"
  | "rewarmStartedAt"
  | "rewarmStartVolume"
  | "rewarmIncrementPerDay"
  | "rewarmTarget"
  | "rewarmSendDays"
  | "rewarmLastSendDay";

/** D32 re-warm term, null without a plan: min(target, start + increment x local days with a send before today). */
export function rewarmAllowance(
  a: Pick<EmailAccount, "timezone"> & Partial<Pick<EmailAccount, RewarmFields>>,
  now: Date,
): number | null {
  if (!a.rewarmStartedAt) return null;
  const today = dayKey(a.timezone, now);
  const priorSendDays = Math.max(
    0,
    (a.rewarmSendDays ?? 0) - (a.rewarmLastSendDay?.toISOString().slice(0, 10) === today ? 1 : 0),
  );
  return Math.min(
    a.rewarmTarget ?? Infinity,
    (a.rewarmStartVolume ?? 5) + (a.rewarmIncrementPerDay ?? 2) * priorSendDays,
  );
}

/**
 * Sends an account may make today: min(user limit, re-warm, health, ramp, floor(providerCap/2)). Never negative.
 * Ramp: start + increment x whole local days since rampStartedAt (createdAt when never stamped).
 * Re-warm (D32, while rewarmStartedAt is set): min(rewarmTarget, start + increment x local days with a campaign send
 * before today), so days the machine was off never grow it.
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
  > &
    Partial<Pick<EmailAccount, RewarmFields>>,
  now: Date,
): number {
  const today = dayKey(a.timezone, now);
  const ramp = a.slowRamp
    ? a.rampStartVolume +
      a.rampIncrementPerDay *
        Math.max(
          0,
          Math.round(
            (Date.parse(today) - Date.parse(dayKey(a.timezone, a.rampStartedAt ?? a.createdAt))) /
              86_400_000,
          ),
        )
    : null;
  const terms = [
    ramp,
    a.dailyLimit,
    maxDailyLimit(a.providerCap),
    rewarmAllowance(a, now),
    a.healthCap, // D34 health throttle (evaluateHealth)
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
