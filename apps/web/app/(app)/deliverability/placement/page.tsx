import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "../../../../components/page-header";
import { SectionTabs } from "../../../../components/section-tabs";
import { getSessionInfo } from "../../../../lib/workspace";
import { DELIVERABILITY_TABS } from "../section";
import { PlacementManager } from "./placement-manager";

export const metadata: Metadata = { title: "Inbox placement" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inbox placement"
        description={
          <>
            Sends one message from the account you pick to each of your own mailboxes that you
            marked as a placement seed (in the account settings), then reports whether it reached
            the inbox or the spam folder. Results appear after about 10 minutes. The test counts
            against the account&apos;s daily quota, and its headers differ slightly from a real
            campaign email.
          </>
        }
        tabs={<SectionTabs tabs={DELIVERABILITY_TABS} />}
      />
      <PlacementManager isAdmin={info.role === "OWNER" || info.role === "ADMIN"} />
    </div>
  );
}
