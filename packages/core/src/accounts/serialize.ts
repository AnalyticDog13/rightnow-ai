import type { EmailAccount, Prisma } from "@rightnow/db/client";
import type { SyncProgress } from "../mail/sync";
import { idleSince } from "../deliverability/lifecycle";
import { effectiveAllowance } from "../quota";
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
  "placementSeed",
  "createdAt",
  "deletedAt",
] as const satisfies readonly (keyof EmailAccount)[];
export type ApiAccount = Pick<EmailAccount, (typeof PUBLIC)[number]> & {
  displayStatus: DisplayStatus;
  /** D34: an internal indicator, not a reputation guarantee. `cap` is the health throttle on the daily allowance. */
  health: { score: number | null; cap: number | null; capAt: Date | null };
  sentToday: number;
  reservedToday: number;
  remainingToday: number;
  /** D33: whole days since the last campaign send, "Resume at full volume" or creation (warm-up does not count). */
  idleDays: number;
  /** D32 re-warm plan view; P5-T06 fills it (rewarmPlanView). */
  rewarm: null;
  /** PS-ACC-31 / PS-SYNC-07: the import position (page token, cursor) and the lease stay private. */
  sync: {
    state: EmailAccount["syncState"];
    lastCompletedAt: Date | null;
    lagSec: number | null;
    errors: number;
    progress: Pick<SyncProgress, "mode" | "folder" | "fetched" | "since"> | null;
    lastError: Prisma.JsonValue | null;
  };
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
  const p = a.syncProgress as SyncProgress | null;
  return {
    ...picked,
    displayStatus: displayStatus(a, now),
    health: { score: a.healthScore, cap: a.healthCap, capAt: a.healthCapAt },
    sentToday: usageToday.sent,
    reservedToday: usageToday.reserved,
    remainingToday: Math.max(0, effectiveAllowance(a, now) - usageToday.sent - usageToday.reserved),
    idleDays: Math.max(0, Math.floor((now.getTime() - idleSince(a).getTime()) / 86_400_000)),
    rewarm: null,
    sync: {
      state: a.syncState,
      lastCompletedAt: a.lastSyncCompletedAt,
      lagSec: a.lastSyncCompletedAt
        ? Math.max(0, Math.floor((now.getTime() - a.lastSyncCompletedAt.getTime()) / 1000))
        : null,
      errors: a.syncErrors,
      progress: p && { mode: p.mode, folder: p.folder, fetched: p.fetched, since: p.since },
      lastError: (a.lastError as { kind?: string } | null)?.kind === "SYNC" ? a.lastError : null,
    },
  };
}
