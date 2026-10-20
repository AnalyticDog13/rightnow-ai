import type { EmailAccount } from "@rightnow/db/client";
import { displayStatus, type DisplayStatus } from "./status";

/** Allowlist: a column added to EmailAccount stays private until it is listed here. */
const PUBLIC = [
  "id",
  "workspaceId",
  "provider",
  "email",
  "fromName",
  "firstName",
  "lastName",
  "replyTo",
  "signature",
  "tags",
  "status",
  "lifecycle",
  "pausedUntil",
  "capTier",
  "providerCap",
  "dailyLimit",
  "minGapSec",
  "randomGapSec",
  "timezone",
  "slowRamp",
  "rampStartVolume",
  "rampIncrementPerDay",
  "rampStartedAt",
  "historyImportDays",
  "nextSendAt",
  "lastSentAt",
  "lastCampaignActivityAt",
  "lastError",
  "lastErrorAt",
  "errorCount24h",
  "autofixState",
  "autofixAt",
  "syncState",
  "lastSyncCompletedAt",
  "healthScore",
  "trackingDomain",
  "trackingDomainStatus",
  "appendToSent",
  "createdAt",
  "deletedAt",
] as const satisfies readonly (keyof EmailAccount)[];
export type ApiAccount = Pick<EmailAccount, (typeof PUBLIC)[number]> & {
  displayStatus: DisplayStatus;
  sentToday: number;
  reservedToday: number;
  remainingToday: number;
};

/** PS-ACC-07: the only shape of an account any API returns; credentials, cursor and lease never leave the server. `usageToday` is today's usage row for the account's timezone. */
export function toApiAccount(
  a: EmailAccount,
  usageToday: { sent: number; reserved: number },
  now: Date = new Date(),
): ApiAccount {
  const picked = Object.fromEntries(PUBLIC.map((k) => [k, a[k]])) as Pick<
    EmailAccount,
    (typeof PUBLIC)[number]
  >;
  return {
    ...picked,
    displayStatus: displayStatus(a, now),
    sentToday: usageToday.sent,
    reservedToday: usageToday.reserved,
    remainingToday: Math.max(0, a.dailyLimit - usageToday.sent - usageToday.reserved),
  };
}
