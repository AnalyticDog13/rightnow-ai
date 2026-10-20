import type { CapTier } from "@rightnow/db/client";
import { maxDailyLimit } from "./factory";

/** D7: highest `providerCap` a user may set per tier. */
export const TIER_MAX_CAP: Record<CapTier, number> = {
  GMAIL_WORKSPACE: 2000,
  GMAIL_CONSUMER: 500,
  MS365: 10000,
  OUTLOOK_COM: 300,
  SMTP: 10000,
};
/** Smallest `minGapSec` per tier (Graph: at most 25 messages a minute). */
export const TIER_MIN_GAP: Record<CapTier, number> = {
  GMAIL_WORKSPACE: 0,
  GMAIL_CONSUMER: 0,
  MS365: 3,
  OUTLOOK_COM: 3,
  SMTP: 0,
};
export type LimitWarning = { field: string; clampedTo: number; reason: string };
type Limits = { providerCap: number; dailyLimit: number; minGapSec: number };

/** Values above a provider limit are clamped and reported, never rejected. */
export function applyLimits(tier: CapTier, cur: Limits, patch: Partial<Limits>) {
  const warnings: LimitWarning[] = [];
  const clamp = (field: string, v: number, to: number, reason: string) => {
    if (v === to) return v;
    warnings.push({ field, clampedTo: to, reason });
    return to;
  };
  const providerCap = Math.min(patch.providerCap ?? cur.providerCap, TIER_MAX_CAP[tier]);
  if (patch.providerCap !== undefined)
    clamp("providerCap", patch.providerCap, providerCap, "tier_max");
  const wanted = patch.dailyLimit ?? cur.dailyLimit;
  const dailyLimit = clamp(
    "dailyLimit",
    wanted,
    Math.min(wanted, maxDailyLimit(providerCap)),
    "provider_cap",
  );
  let minGapSec = patch.minGapSec ?? cur.minGapSec;
  if (patch.minGapSec !== undefined)
    minGapSec = clamp(
      "minGapSec",
      minGapSec,
      Math.max(minGapSec, TIER_MIN_GAP[tier]),
      "provider_min_gap",
    );
  return { values: { providerCap, dailyLimit, minGapSec }, warnings };
}
