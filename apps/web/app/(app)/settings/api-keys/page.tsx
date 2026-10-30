import { API_SCOPES } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiKeys } from "../../../../components/api-keys";
import { Callout } from "../../../../components/callout";
import { PageHeader } from "../../../../components/page-header";
import { SectionTabs } from "../../../../components/section-tabs";
import { getSessionInfo } from "../../../../lib/workspace";
import { SETTINGS_TABS } from "../tabs";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  if (info.role !== "OWNER" && info.role !== "ADMIN")
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Callout tone="neutral">Only workspace owners and admins can manage API keys.</Callout>
      </div>
    );
  const keys = await prisma.apiKey.findMany({
    where: { workspaceId: info.workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  return (
    <div className="flex flex-col gap-6">
      <Header />
      <ApiKeys
        scopes={[...API_SCOPES]}
        keys={keys.map((k) => ({
          ...k,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}

function Header() {
  return (
    <PageHeader
      title="API keys"
      description="Keys act as a workspace member. Admin-only actions (connect, disconnect, delete, test-send) are not available to keys."
      tabs={<SectionTabs tabs={SETTINGS_TABS} />}
    />
  );
}
