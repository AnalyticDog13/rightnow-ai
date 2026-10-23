"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Tabs } from "../../../components/tabs";
import type { Member, Named } from "../leads/bulk-bar";
import { ActivityTab } from "./activity-tab";
import { Board } from "./board";
import { Filters } from "./filters";
import { boardQuery } from "./query";
import { StageSettings } from "./stage-settings";
import { TasksTab } from "./tasks-tab";
import type { BoardData } from "./types";

export function CrmClient({
  initial,
  stages,
  campaigns,
  lists,
  members,
  canEdit,
  isAdmin,
  currency,
  currencyLocked,

  timezone,
}: {
  initial: BoardData | null;
  stages: Named[];
  campaigns: Named[];
  lists: Named[];
  members: Member[];
  canEdit: boolean;
  isAdmin: boolean;
  currency: string;
  currencyLocked: boolean;

  timezone: string;
}) {
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get("tab") === "tasks" ? "tasks" : "opportunities");
  const tabs = [
    { id: "opportunities", label: "Opportunities" },
    { id: "tasks", label: "Tasks" },
    { id: "activity", label: "Activity" },
    ...(isAdmin ? [{ id: "settings", label: "Pipeline settings" }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
        <Link href="/leads" className="text-sm underline">
          Leads
        </Link>
      </div>
      <Tabs label="CRM views" tabs={tabs} value={tab} onChange={setTab}>
        {tab === "opportunities" && (
          <div className="flex flex-col gap-3">
            <Filters campaigns={campaigns} lists={lists} members={members} stages={stages} />
            <Board
              initial={initial}
              query={boardQuery(Object.fromEntries(sp), timezone)}
              members={members}
              campaigns={campaigns}
              canEdit={canEdit}
            />
          </div>
        )}
        {tab === "tasks" && <TasksTab members={members} canEdit={canEdit} />}
        {tab === "activity" && <ActivityTab members={members} />}
        {tab === "settings" && (
          <StageSettings currency={currency} currencyLocked={currencyLocked} />
        )}
      </Tabs>
    </div>
  );
}
