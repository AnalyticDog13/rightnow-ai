import { listLabels, listLists } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import Link from "next/link";
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <nav aria-label="Lead tools" className="flex gap-4 text-sm underline">
          <Link href="/leads/lists">Lead lists</Link>
          <Link href="/blocklist">Blocklist</Link>
        </nav>
      </div>
      <LeadsTable
        lists={lists.map((l) => ({ id: l.id, name: l.name }))}
        labels={labels.map((l) => l.name)}
        members={members.map((m) => ({ userId: m.userId, name: m.user.name || m.user.email }))}
        canEdit={info.role !== "VIEWER"}
        isAdmin={isAdmin}
        initialListId={(await searchParams).listId ?? ""}
      />
    </div>
  );
}
