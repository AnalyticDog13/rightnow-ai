import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "../../../components/page-header";
import { SectionTabs } from "../../../components/section-tabs";
import { getSessionInfo } from "../../../lib/workspace";
import { LEAD_TABS } from "../leads/labels";
import { BlocklistManager } from "./blocklist-manager";

export const metadata: Metadata = { title: "Blocklist" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Blocklist"
        description="Domains match exactly (blocking evil.test does not block mail.evil.test). Addresses and domains here are never emailed, in any campaign. Unsubscribes, bounces and complaints are added automatically."
        tabs={<SectionTabs tabs={LEAD_TABS} />}
      />
      <BlocklistManager
        canEdit={info.role !== "VIEWER"}
        isAdmin={info.role === "OWNER" || info.role === "ADMIN"}
      />
    </div>
  );
}
