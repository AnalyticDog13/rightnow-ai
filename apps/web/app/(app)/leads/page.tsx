import { listLabels, listLists } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { LeadsTable } from "./leads-table";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ listId?: string }>;
}) {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const ws = info.workspaceId;
  const [lists, labels, members] = await Promise.all([
    listLists(prisma, ws),
    listLabels(prisma, ws),
    prisma.member.findMany({
      where: { workspaceId: ws },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  const isAdmin = info.role === "OWNER" || info.role === "ADMIN";
  return (
    <LeadsTable
      lists={lists.map((l) => ({ id: l.id, name: l.name }))}
      labels={labels.map((l) => l.name)}
      members={members.map((m) => ({ userId: m.userId, name: m.user.name || m.user.email }))}
      canEdit={info.role !== "VIEWER"}
      isAdmin={isAdmin}
      initialListId={(await searchParams).listId ?? ""}
    />
  );
}
