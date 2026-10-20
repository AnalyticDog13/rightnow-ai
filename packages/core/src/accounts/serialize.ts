import type { EmailAccount } from "@rightnow/db/client";

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
export type ApiAccount = Pick<EmailAccount, (typeof PUBLIC)[number]>;

/** PS-ACC-07: the only shape of an account any API returns; credentials, cursor and lease never leave the server. */
export function toApiAccount(a: EmailAccount): ApiAccount {
  return Object.fromEntries(PUBLIC.map((k) => [k, a[k]])) as ApiAccount;
}
