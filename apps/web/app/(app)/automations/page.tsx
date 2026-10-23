import { listCampaigns, listLabels, listLists, WEBHOOK_EVENTS } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { AutomationsClient } from "./automations-client";

export const metadata: Metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const ws = info.workspaceId;
  const [campaigns, lists, members, accounts, subsequences, labels] = await Promise.all([
    listCampaigns(prisma, ws),
    listLists(prisma, ws),
    prisma.member.findMany({
      where: { workspaceId: ws },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    prisma.emailAccount.findMany({
      where: { workspaceId: ws, deletedAt: null },
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    }),
    prisma.subsequence.findMany({
      where: { campaign: { workspaceId: ws } },
      select: { id: true, name: true, campaign: { select: { name: true } } },
    }),
    listLabels(prisma, ws),
  ]);
  return (
    <AutomationsClient
      refs={{
        campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
        lists: lists.map((l) => ({ id: l.id, name: l.name })),
        members: members.map((m) => ({ userId: m.userId, name: m.user.name || m.user.email })),
        accounts: accounts.map((a) => ({ id: a.id, name: a.email })),
        subsequences: subsequences.map((s) => ({
          id: s.id,
          name: `${s.campaign.name}: ${s.name}`,
        })),
      }}
      canEdit={info.role !== "VIEWER"}
      isAdmin={info.role === "OWNER" || info.role === "ADMIN"}
      events={WEBHOOK_EVENTS}
      labels={labels.map((l) => l.name)}
    />
  );
}
