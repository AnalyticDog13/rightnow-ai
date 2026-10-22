import { Prisma, type CampaignLead, type StopReason } from "@rightnow/db/client";

export type CampaignLeadStatus =
  "Active" | "Paused" | "Completed" | "Bounced" | "Unsubscribed" | "Skipped";
export const CAMPAIGN_LEAD_STATUSES = [
  "Active",
  "Paused",
  "Completed",
  "Bounced",
  "Unsubscribed",
  "Skipped",
] as const;

/** CampaignLead states that are still open (may get mail or resume). The one list every query uses (audit A1). */
export const OPEN_STATES = ["QUEUED", "ACTIVE", "PAUSED"] as const;
/** OPEN_STATES as a raw-SQL parameter: `cl.state = ANY(${OPEN_STATES_SQL})`. */
export const OPEN_STATES_SQL = Prisma.sql`${[...OPEN_STATES]}::text[]::"CampaignLeadState"[]`;

const DONE: StopReason[] = ["REPLIED", "AUTO_REPLIED", "COMPANY_REPLIED", "MANUAL"];
const SKIPPED: StopReason[] = ["SUPPRESSED", "SKIPPED", "SEND_FAILED"];
// M3: a spam complaint reads like an unsubscribe (the lead asked, in effect, for no more mail)
const UNSUBSCRIBED: StopReason[] = ["UNSUBSCRIBED", "COMPLAINED"];

/** PS-LEAD-18 display status of one CampaignLead. */
export function campaignLeadStatus(
  cl: Pick<CampaignLead, "state" | "stopReason">,
): CampaignLeadStatus {
  if (cl.state === "QUEUED" || cl.state === "ACTIVE") return "Active";
  if (cl.state === "PAUSED") return "Paused";
  if (cl.stopReason === "BOUNCED") return "Bounced";
  if (cl.stopReason && UNSUBSCRIBED.includes(cl.stopReason)) return "Unsubscribed";
  if (cl.stopReason && SKIPPED.includes(cl.stopReason)) return "Skipped";
  return "Completed"; // COMPLETED, or STOPPED by a reply / manually / with no reason
}

/** The same table as a Prisma filter, for the lead list. Keep in step with campaignLeadStatus. */
const WHERE: Record<CampaignLeadStatus, Prisma.CampaignLeadWhereInput> = {
  Active: { state: { in: ["QUEUED", "ACTIVE"] } },
  Paused: { state: "PAUSED" },
  Bounced: { state: "STOPPED", stopReason: "BOUNCED" },
  Unsubscribed: { state: "STOPPED", stopReason: { in: UNSUBSCRIBED } },
  Skipped: { state: "STOPPED", stopReason: { in: SKIPPED } },
  Completed: {
    OR: [
      { state: "COMPLETED" },
      { state: "STOPPED", OR: [{ stopReason: { in: DONE } }, { stopReason: null }] },
    ],
  },
};
export const campaignLeadStatusWhere = (s: CampaignLeadStatus) => WHERE[s];
