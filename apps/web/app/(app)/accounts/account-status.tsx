import type { ApiAccount, DisplayStatus } from "@rightnow/core";
import { ACCOUNT_STATUS, pillFor, StatusPill } from "../../../components/status-pill";

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  TEMP_PAUSED: "Paused until later",
  CONNECTION_ERROR: "Connection error",
  SOFT_BOUNCE_ERROR: "Soft bounce error",
  SENDING_ERROR: "Sending error",
  REWARMING: "Re-warming",
  INACTIVE: "Inactive",
  NEEDS_ATTENTION: "Needs attention",
};
export const statusLabel = (a: ApiAccount) =>
  a.status === "DISCONNECTED" ? "Disconnected" : STATUS_LABEL[a.displayStatus];

/** B4.4 status pill of an account; its title is the last error, which the drawer also shows. */
export function AccountPill({ account: a }: { account: ApiAccount }) {
  const label = statusLabel(a);
  return (
    <StatusPill
      {...pillFor(ACCOUNT_STATUS, label)}
      title={(a.lastError as { message?: string } | null)?.message}
    >
      {label}
    </StatusPill>
  );
}
