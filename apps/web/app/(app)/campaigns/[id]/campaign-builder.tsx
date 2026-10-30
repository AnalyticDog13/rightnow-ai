"use client";

import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Callout } from "../../../../components/callout";
import { PageHeader } from "../../../../components/page-header";
import { Tabs } from "../../../../components/tabs";
import { Button } from "../../../../components/ui/button";
import { call, errorText } from "../../accounts/api-client";
import { StatusBadge } from "../status-badge";
import { AccountsTab } from "./accounts-tab";
import { LeadsTab } from "./leads-tab";
import { OptionsTab } from "./options-tab";
import { ScheduleTab } from "./schedule-tab";
import { SequencesTab } from "./sequences-tab";
import { StatusBanner, type Why } from "./status-banner";
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
export type AccountView = {
  id: string;
  email: string;
  tags: string[];
  /** DisplayStatus, or DISCONNECTED */
  status: string;
  sentToday: number;
  capacity: number;
};
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
/** The tab that fixes a launch blocker (B5.6: link-button on the issue + warning dot on the tab). */
const FIX_TAB: Record<string, string> = {
  no_leads: "leads",
  no_steps: "sequences",
  no_accounts: "accounts",
  no_schedule: "schedule",
};

export function CampaignBuilder(p: Props) {
  const { campaign: c, canEdit } = p;
  const router = useRouter();
  const [tab, setTab] = useState("leads");
  const [version, setVersion] = useState(0);
  const [blocked, setBlocked] = useState<Issue[]>([]);
  const [notes, setNotes] = useState<Issue[]>([]);
  const [error, setError] = useState("");
  const [why, setWhy] = useState<Why | null>(null);
  useEffect(() => {
    let live = true;
    void call(`/api/v1/campaigns/${c.id}/status`, "GET").then((r) => {
      if (live && r.ok) setWhy(r.json as Why);
    });
    return () => {
      live = false;
    };
  }, [c.id, version]);

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
    window.dispatchEvent(new Event("sending:changed")); // the shell's send meter reloads
    changed();
  }

  const attention = new Set(blocked.map((i) => FIX_TAB[i.code]));
  const label: Record<string, string> = {
    leads: "Leads",
    sequences: "Sequences",
    accounts: "Accounts",
    schedule: "Schedule",
    options: "Options",
    subsequences: "Subsequences",
  };
  // B5.6: the order of work (who, what, from where, when, how); Subsequences only after launch
  const tabs = ["leads", "sequences", "accounts", "schedule", "options"]
    .concat(c.launchedAt ? ["subsequences"] : [])
    .map((id) => ({ id, label: label[id]!, attention: attention.has(id) }));
  const common = { campaignId: c.id, canEdit, onChange: changed };
  const resumable = ["Paused", "Bounce Protect", "Accounts Unhealthy", "Completed"].includes(
    p.status,
  );

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-[13px]/[18px]">
        <ol className="hidden items-center gap-1 md:flex">
          <li>
            <Link href="/campaigns" className="text-fg-muted hover:text-fg hover:underline">
              Campaigns
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3 text-fg-subtle" />
          </li>
          <li aria-current="page" className="truncate text-fg">
            {c.name}
          </li>
        </ol>
        <Link
          href="/campaigns"
          className="inline-flex min-h-11 items-center gap-1 text-fg-muted hover:text-fg md:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Campaigns
        </Link>
      </nav>
      <PageHeader
        title={c.name}
        status={<StatusBadge status={p.status} sending={why?.sending} />}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/analytics?campaignIds=${c.id}`}>
                <BarChart3 aria-hidden />
                Analytics
              </Link>
            </Button>
            {canEdit && p.status === "Draft" && (
              <Button onClick={() => void go("launch")}>Launch</Button>
            )}
            {canEdit && resumable && <Button onClick={() => void go("resume")}>Resume</Button>}
            {canEdit && p.status === "Active" && (
              <Button variant="outline" onClick={() => void go("pause")}>
                Pause
              </Button>
            )}
          </>
        }
      />

      {(blocked.length > 0 || error) && (
        <Callout tone="danger" role="alert" title={error || "This campaign cannot launch yet:"}>
          {blocked.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1">
              {blocked.map((i, n) => (
                <li key={n} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{FIX[i.code] ?? i.message}</span>
                  {i.code === "no_physical_address" ? (
                    <Button asChild variant="link" className="text-[13px]/[18px]">
                      <Link href="/settings">Open Settings</Link>
                    </Button>
                  ) : (
                    FIX_TAB[i.code] && (
                      <Button
                        variant="link"
                        className="text-[13px]/[18px]"
                        onClick={() => setTab(FIX_TAB[i.code]!)}
                      >
                        Open {label[FIX_TAB[i.code]!]}
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </Callout>
      )}
      {notes.length > 0 && (
        <Callout tone="warning">
          <ul className="list-disc pl-4" aria-label="Launch warnings">
            {notes.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </Callout>
      )}
      <StatusBanner why={why} onOpen={setTab} />

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
