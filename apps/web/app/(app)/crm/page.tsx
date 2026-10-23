import { ensureStages, listCampaigns, listLists, pipelineBoard } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { CrmClient } from "./crm-client";
import { boardQuery } from "./query";

export const metadata: Metadata = { title: "CRM" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const ws = info.workspaceId;
  const sp = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const [stages, campaigns, lists, members, settings, moneyDeals] = await Promise.all([
    ensureStages(prisma, ws),
    listCampaigns(prisma, ws),
    listLists(prisma, ws),
    prisma.member.findMany({
      where: { workspaceId: ws },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    prisma.workspace.findUniqueOrThrow({
      where: { id: ws },
      select: { currency: true, crmAutoOpportunity: true, timezone: true },
    }),
    // the currency is fixed while any deal carries money (409 currency_in_use)
    prisma.opportunity.count({
      where: { workspaceId: ws, OR: [{ value: { gt: 0 } }, { cashCollected: { gt: 0 } }] },
    }),
  ]);
  // a bad filter in the URL leaves the board to the client, which shows the API's error
  const board = await pipelineBoard(prisma, ws, boardQuery(sp, settings.timezone)).catch(
    () => null,
  );
  return (
    <CrmClient
      initial={board && JSON.parse(JSON.stringify(board))}
      stages={stages.map((s) => ({ id: s.id, name: s.name }))}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      lists={lists.map((l) => ({ id: l.id, name: l.name }))}
      members={members.map((m) => ({ userId: m.userId, name: m.user.name || m.user.email }))}
      canEdit={info.role !== "VIEWER"}
      isAdmin={info.role === "OWNER" || info.role === "ADMIN"}
      currency={settings.currency}
      currencyLocked={moneyDeals > 0}
      autoOpportunity={settings.crmAutoOpportunity}
      timezone={settings.timezone}
    />
  );
}
