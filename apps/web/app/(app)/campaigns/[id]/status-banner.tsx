"use client";

import { AlertCircle, Info } from "lucide-react";
import Link from "next/link";
import { Button } from "../../../../components/ui/button";
import { cn } from "../../../../lib/utils";

type Reason = { code: string; message: string; blocking: boolean };
export type Why = { sending: boolean; reasons: Reason[] };

/** Reasons a tab (or another page) fixes: the row ends with an "Open {Tab}" link-button. */
const FIX_AT: Record<string, { tab: string; label: string } | { href: string; label: string }> = {
  no_accounts: { tab: "accounts", label: "Accounts" },
  accounts_unavailable: { tab: "accounts", label: "Accounts" },
  outside_window: { tab: "schedule", label: "Schedule" },
  no_eligible_leads: { tab: "leads", label: "Leads" },
  leads_paused: { tab: "leads", label: "Leads" },
  held_messages: { href: "/scheduled", label: "Scheduled emails" },
  account_inactive: { href: "/accounts", label: "Email Accounts" },
  no_physical_address: { href: "/settings", label: "Settings" },
};

// One sentence per reason code. The API message is the fallback for a code added later.
const SENTENCE: Record<string, string> = {
  draft: "This campaign is a draft. Launch it to start sending.",
  paused: "This campaign is paused.",
  completed: "This campaign has finished. Resume it to send to leads added since.",
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
export function StatusBanner({ why, onOpen }: { why: Why | null; onOpen: (tab: string) => void }) {
  if (!why) return null;
  const sorted = [...why.reasons].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return (
    <section
      aria-label="Campaign status"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            why.sending ? "animate-pulse-dot bg-success-solid" : "bg-warning-solid",
          )}
        />
        {why.sending ? "Sending" : "Not sending right now"}
      </p>
      {sorted.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {sorted.map((r) => {
            const fix = FIX_AT[r.code];
            const Icon = r.blocking ? AlertCircle : Info;
            return (
              <li key={r.code} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    r.blocking ? "text-danger" : "text-fg-muted",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">{SENTENCE[r.code] ?? r.message}</span>
                {fix &&
                  ("tab" in fix ? (
                    <Button
                      variant="link"
                      className="text-[13px]/5"
                      onClick={() => onOpen(fix.tab)}
                    >
                      Open {fix.label}
                    </Button>
                  ) : (
                    <Button asChild variant="link" className="text-[13px]/5">
                      <Link href={fix.href}>Open {fix.label}</Link>
                    </Button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
