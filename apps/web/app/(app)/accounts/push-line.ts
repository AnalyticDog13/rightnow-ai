import type { ApiAccount } from "@rightnow/core";

/** D48: push when it works, otherwise why not; polling always runs. */
export function pushLine(push: NonNullable<ApiAccount["push"]>): string {
  const polling = " · Polling every 2 min";
  if (push.state === "active" && push.expiresAt)
    return `Push: active until ${new Date(push.expiresAt).toLocaleString()}${polling}`;
  if (push.state === "expired") return `Push: expired${polling}`;
  if (push.state === "failed") return `Push: failed: ${push.error ?? "unknown"}${polling}`;
  if (push.state === "pending") return `Push: starting${polling}`;
  return `Push: not configured${polling}`;
}
