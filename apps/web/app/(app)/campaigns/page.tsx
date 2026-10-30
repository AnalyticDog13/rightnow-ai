import { campaignOverview, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/page-header";
import { SectionTabs } from "../../../components/section-tabs";
import { getSessionInfo } from "../../../lib/workspace";
import { CampaignsTable, CreateCampaign } from "./campaigns-table";
import { CAMPAIGN_TABS } from "./section";

export const metadata: Metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const rows = await campaignOverview(prisma, info.workspaceId, systemClock.now());
  const canEdit = info.role !== "VIEWER";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description="Sequences that send from your mailboxes on a schedule."
        actions={canEdit ? <CreateCampaign /> : undefined}
        tabs={<SectionTabs tabs={CAMPAIGN_TABS} />}
      />
      <CampaignsTable rows={rows} canEdit={canEdit} />
    </div>
  );
}
