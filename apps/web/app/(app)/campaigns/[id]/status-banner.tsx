"use client";

import { useEffect, useState } from "react";
import { call } from "../../accounts/api-client";

type Reason = { code: string; message: string; blocking: boolean };

// One sentence per reason code. The API message is the fallback for a code added later.
const SENTENCE: Record<string, string> = {
  draft: "This campaign is a draft. Launch it to start sending.",
  paused: "This campaign is paused.",
  completed: "This campaign has finished.",
  not_started: "Waiting for the start date.",
  ended: "The end date has passed.",
  outside_window: "Outside the sending window.",
  no_accounts: "No sending account is assigned.",
  accounts_unavailable: "The assigned accounts are paused or need attention.",
  sync_pending: "Waiting for mailbox sync",
  provider_not_verified: "Real sending is off until the provider passes live verification.",
  no_physical_address: "Add your physical address in Settings.",
  account_quota_reached: "Every account reached its daily limit.",
  campaign_quota_reached: "The campaign reached its daily limit.",
  workspace_quota_reached: "The workspace reached its daily limit.",
  company_stop_waiting_for_sync: "Waiting for every account to sync (stop-company-on-reply is on).",
  no_eligible_leads: "No leads are waiting to be contacted.",
  claim_errors: "Some emails hit errors and will be retried.",
  held_messages: "Some emails are held. Review them under Scheduled emails.",
  leads_suppressed: "Some leads were stopped because they are suppressed.",
  leads_paused: "Some leads are paused.",
};

/** Why the campaign is or is not sending (explainer, P3-T10a): blocking reasons first, then notes. */
export function StatusBanner({ campaignId, version }: { campaignId: string; version: number }) {
  const [why, setWhy] = useState<{ sending: boolean; reasons: Reason[] } | null>(null);
  useEffect(() => {
    let live = true;
    void call(`/api/v1/campaigns/${campaignId}/status`, "GET").then((r) => {
      if (live && r.ok) setWhy(r.json as typeof why);
    });
    return () => {
      live = false;
    };
  }, [campaignId, version]);
  if (!why) return null;
  const sorted = [...why.reasons].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return (
    <section
      aria-label="Campaign status"
      className="rounded-md border border-border bg-card p-3 text-sm"
    >
      <p className="font-medium">{why.sending ? "Sending" : "Not sending right now"}</p>
      <ul className="list-disc pl-5">
        {sorted.map((r) => (
          <li key={r.code}>{SENTENCE[r.code] ?? r.message}</li>
        ))}
      </ul>
    </section>
  );
}
