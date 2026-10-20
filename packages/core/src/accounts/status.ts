import type { EmailAccount } from "@rightnow/db/client";

export type DisplayStatus =
  | "ACTIVE"
  | "PAUSED"
  | "TEMP_PAUSED"
  | "CONNECTION_ERROR"
  | "SOFT_BOUNCE_ERROR"
  | "SENDING_ERROR"
  | "REWARMING"
  | "INACTIVE"
  | "NEEDS_ATTENTION";

const BY_KIND = {
  CONNECTION: "CONNECTION_ERROR",
  SOFT_BOUNCE: "SOFT_BOUNCE_ERROR",
  SENDING: "SENDING_ERROR",
} as const;

/** PS-ACC-14. Errors outrank pauses: a paused account with a broken connection still shows the error. */
export function displayStatus(
  a: Pick<EmailAccount, "lifecycle" | "pausedUntil" | "lastError">,
  now: Date,
): DisplayStatus {
  if (a.lifecycle === "NEEDS_ATTENTION") return "NEEDS_ATTENTION";
  const kind = (a.lastError as { kind?: keyof typeof BY_KIND } | null)?.kind;
  if (kind && BY_KIND[kind]) return BY_KIND[kind];
  if (a.lifecycle === "PAUSED")
    return a.pausedUntil && a.pausedUntil > now ? "TEMP_PAUSED" : "PAUSED";
  if (a.lifecycle === "REWARMING" || a.lifecycle === "INACTIVE") return a.lifecycle;
  return "ACTIVE";
}
