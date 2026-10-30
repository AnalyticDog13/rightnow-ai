import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/page-header";
import { SectionTabs } from "../../../components/section-tabs";
import { getSessionInfo } from "../../../lib/workspace";
import { CAMPAIGN_TABS } from "../campaigns/section";
import { ScheduledView } from "./scheduled-view";

export const metadata: Metadata = { title: "Scheduled emails" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Scheduled emails"
        description="Every email the sender will send, is holding, or could not confirm. Held and unknown-outcome emails are never resent automatically."
        tabs={<SectionTabs tabs={CAMPAIGN_TABS} />}
      />
      <ScheduledView
        canEdit={info.role !== "VIEWER"}
        isAdmin={info.role === "OWNER" || info.role === "ADMIN"}
      />
    </div>
  );
}
