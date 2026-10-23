import { listAccounts, listCampaigns, listLists } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { AnalyticsClient } from "./analytics-client";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const ws = info.workspaceId;
  const [campaigns, { accounts }, lists, members, settings] = await Promise.all([
    listCampaigns(prisma, ws),
    listAccounts(prisma, ws, { take: 500 }),
    listLists(prisma, ws),
    prisma.member.findMany({
      where: { workspaceId: ws },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    prisma.workspace.findUniqueOrThrow({
      where: { id: ws },
      select: { timezone: true, currency: true },
    }),
  ]);
  return (
    <AnalyticsClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      accounts={accounts.map((a) => ({ id: a.id, name: a.email }))}
      lists={lists.map((l) => ({ id: l.id, name: l.name }))}
      members={members.map((m) => ({ userId: m.userId, name: m.user.name || m.user.email }))}
      timezone={settings.timezone}
      currency={settings.currency}
      canEdit={info.role !== "VIEWER"}
    />
  );
}
