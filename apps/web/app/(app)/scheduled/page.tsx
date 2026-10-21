import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { ScheduledView } from "./scheduled-view";

export const metadata: Metadata = { title: "Scheduled emails" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Scheduled emails</h1>
        <Link href="/campaigns" className="text-sm underline">
          Back to campaigns
        </Link>
      </div>
      <ScheduledView
        canEdit={info.role !== "VIEWER"}
        isAdmin={info.role === "OWNER" || info.role === "ADMIN"}
      />
    </div>
  );
}
