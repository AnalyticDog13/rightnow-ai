import {
  CAMPAIGN_LEAD_STATUSES,
  CampaignError,
  campaignVariables,
  displayCampaignStatus,
  getCampaign,
  listAccounts,
  listLists,
  PRESETS,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionInfo } from "../../../../lib/workspace";
import { CampaignBuilder } from "./campaign-builder";

export const metadata: Metadata = { title: "Campaign" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const ws = info.workspaceId;
  const { id } = await params;
  const campaign = await getCampaign(prisma, ws, id).catch((e) => {
    if (e instanceof CampaignError) notFound();
    throw e;
  });
  const [subs, variables, { accounts }, lists, members] = await Promise.all([
    prisma.subsequence.count({ where: { campaignId: id, active: true } }),
    campaignVariables(prisma, id),
    listAccounts(prisma, ws, { take: 500 }),
    listLists(prisma, ws),
    prisma.member.findMany({
      where: { workspaceId: ws },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  return (
    <CampaignBuilder
      // Decimal and Date columns become strings: the client only needs plain JSON
      campaign={JSON.parse(JSON.stringify(campaign))}
      status={displayCampaignStatus(campaign, subs > 0)}
      variables={[...variables]}
      accounts={accounts.map((a) => ({
        id: a.id,
        email: a.email,
        tags: a.tags,
        status: a.status === "DISCONNECTED" ? "DISCONNECTED" : a.displayStatus,
        sentToday: a.sentToday,
        capacity: a.sentToday + a.reservedToday + a.remainingToday,
      }))}
      lists={lists.map((l) => ({ id: l.id, name: l.name }))}
      members={members.map((m) => ({ userId: m.userId, name: m.user.name || m.user.email }))}
      leadStatuses={[...CAMPAIGN_LEAD_STATUSES]}
      presets={PRESETS}
      canEdit={info.role !== "VIEWER"}
      isAdmin={info.role === "OWNER" || info.role === "ADMIN"}
    />
  );
}
