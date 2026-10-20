import { API_SCOPES } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiKeys } from "../../../../components/api-keys";
import { Card } from "../../../../components/ui/card";
import { getSessionInfo } from "../../../../lib/workspace";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  if (info.role !== "OWNER" && info.role !== "ADMIN")
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <Card className="mt-6 text-sm text-muted-foreground">
          Only workspace owners and admins can manage API keys.
        </Card>
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
    <ApiKeys
      scopes={[...API_SCOPES]}
      keys={keys.map((k) => ({
        ...k,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
      }))}
    />
  );
}
