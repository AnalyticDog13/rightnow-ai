import { campaignOverview, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { CampaignsTable } from "./campaigns-table";

export const metadata: Metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const rows = await campaignOverview(prisma, info.workspaceId, systemClock.now());
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <Link href="/scheduled" className="text-sm underline">
          Scheduled emails
        </Link>
      </div>
      <CampaignsTable rows={rows} canEdit={info.role !== "VIEWER"} />
    </div>
  );
}
