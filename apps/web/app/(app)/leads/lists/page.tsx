import { listLists, listStats } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../../lib/workspace";
import { ListsManager } from "./lists-manager";

export const metadata: Metadata = { title: "Lead Lists" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const lists = await listLists(prisma, info.workspaceId);
  // one small grouped query per list; counts are always read from the database
  const stats = await Promise.all(lists.map((l) => listStats(prisma, info.workspaceId, l.id)));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Lead Lists</h1>
        <Link href="/leads" className="text-sm underline">
          Back to leads
        </Link>
      </div>
      <ListsManager
        lists={lists.map((l, i) => ({ id: l.id, name: l.name, count: l.count, stats: stats[i]! }))}
        canEdit={info.role !== "VIEWER"}
      />
    </div>
  );
}
