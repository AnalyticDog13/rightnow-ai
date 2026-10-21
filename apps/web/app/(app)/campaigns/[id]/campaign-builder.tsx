"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Tabs } from "../../../../components/tabs";
import { Button } from "../../../../components/ui/button";
import { call, errorText } from "../../accounts/api-client";
import { StatusBadge } from "../status-badge";
import { AccountsTab } from "./accounts-tab";
import { LeadsTab } from "./leads-tab";
import { OptionsTab } from "./options-tab";
import { ScheduleTab } from "./schedule-tab";
import { SequencesTab } from "./sequences-tab";
import { StatusBanner } from "./status-banner";
import { SubsequencesTab } from "./subsequences-tab";

export type Named = { id: string; name: string };
export type CampaignView = {
  id: string;
  name: string;
  status: string;
  launchedAt: string | null;
  startAt: string | null;
  endAt: string | null;
  schedules: { name: string; timezone: string; days: number; from: string; to: string }[];
  accounts: { accountId: string }[];
  accountTags: string[];
  // every option of the campaign (Options tab); typed loosely because the tab reads them by key
  [option: string]: unknown;
};
export type AccountView = { id: string; email: string; tags: string[]; status: string };
export type Props = {
  campaign: CampaignView;
  status: string;
  variables: string[];
  accounts: AccountView[];
  lists: Named[];
  members: { userId: string; name: string }[];
  leadStatuses: string[];
  presets: Record<string, { days: number; from: string; to: string }>;
  canEdit: boolean;
  isAdmin: boolean;
};
type Issue = { code: string; level: string; message: string };

// The API's wording for these is for developers; the builder says what to do.
const FIX: Record<string, string> = {
  no_physical_address: "Add your physical address in Settings, then launch again.",
  no_leads: "Add leads on the Leads tab.",
  no_steps: "Add a first step with at least one active variant on the Sequences tab.",
  no_accounts: "Assign at least one usable sending account on the Accounts tab.",
  no_schedule: "Add a sending schedule on the Schedule tab.",
};

export function CampaignBuilder(p: Props) {
  const { campaign: c, canEdit } = p;
  const router = useRouter();
  const [tab, setTab] = useState("leads");
  const [version, setVersion] = useState(0);
  const [blocked, setBlocked] = useState<Issue[]>([]);
  const [notes, setNotes] = useState<Issue[]>([]);
  const [error, setError] = useState("");

  // Anything a tab saves can change why the campaign is or is not sending.
  const changed = () => {
    setVersion((v) => v + 1);
    router.refresh();
  };
  async function go(verb: "launch" | "resume" | "pause") {
    setBlocked([]);
    setError("");
    const r = await call(
      `/api/v1/campaigns/${c.id}/${verb}`,
      "POST",
      verb === "pause" ? undefined : {},
    );
    if (r.status === 422 && Array.isArray(r.json.issues)) setBlocked(r.json.issues as Issue[]);
    else if (!r.ok) setError(errorText(r));
    setNotes(r.ok && Array.isArray(r.json.warnings) ? (r.json.warnings as Issue[]) : []);
    changed();
  }

  const tabs = [
    { id: "leads", label: "Leads" },
    { id: "sequences", label: "Sequences" },
    ...(c.launchedAt ? [{ id: "subsequences", label: "Subsequences" }] : []),
    { id: "schedule", label: "Schedule" },
    { id: "options", label: "Options" },
    { id: "accounts", label: "Accounts" },
  ];
  const common = { campaignId: c.id, canEdit, onChange: changed };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <StatusBadge status={p.status} />
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {p.status === "Draft" && <Button onClick={() => void go("launch")}>Launch</Button>}
            {["Paused", "Bounce Protect", "Accounts Unhealthy", "Completed"].includes(p.status) && (
              <Button onClick={() => void go("resume")}>Resume</Button>
            )}
            {p.status === "Active" && (
              <Button variant="outline" onClick={() => void go("pause")}>
                Pause
              </Button>
            )}
          </div>
        )}
      </div>

      {(blocked.length > 0 || error) && (
        <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
          <p className="font-medium">{error || "This campaign cannot launch yet:"}</p>
          <ul className="list-disc pl-5">
            {blocked.map((i, n) => (
              <li key={n}>
                {FIX[i.code] ?? i.message}
                {i.code === "no_physical_address" && (
                  <>
                    {" "}
                    <Link href="/settings" className="underline">
                      Open Settings
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {notes.length > 0 && (
        <ul
          className="list-disc rounded-md border border-border p-3 pl-8 text-sm"
          aria-label="Launch warnings"
        >
          {notes.map((i, n) => (
            <li key={n}>{i.message}</li>
          ))}
        </ul>
      )}
      <StatusBanner campaignId={c.id} version={version} />

      <Tabs label="Campaign sections" tabs={tabs} value={tab} onChange={setTab}>
        {tab === "leads" && (
          <LeadsTab {...common} lists={p.lists} statuses={p.leadStatuses} version={version} />
        )}
        {tab === "sequences" && (
          <SequencesTab {...common} variables={p.variables} isAdmin={p.isAdmin} />
        )}
        {tab === "subsequences" && (
          <SubsequencesTab {...common} variables={p.variables} isAdmin={p.isAdmin} />
        )}
        {tab === "schedule" && <ScheduleTab {...common} campaign={c} presets={p.presets} />}
        {tab === "options" && <OptionsTab {...common} campaign={c} members={p.members} />}
        {tab === "accounts" && <AccountsTab {...common} campaign={c} accounts={p.accounts} />}
      </Tabs>
    </div>
  );
}
