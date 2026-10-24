import { getAiSettings, getVerifierSettings, getWorkspaceSettings } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AiSettings } from "../../../components/ai-settings";
import { VerifierSettings } from "../../../components/verifier-settings";
import { WorkspaceSettings } from "../../../components/workspace-settings";
import { getSessionInfo } from "../../../lib/workspace";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const admin = info.role === "OWNER" || info.role === "ADMIN";
  const s = admin ? await getWorkspaceSettings(prisma, info.workspaceId) : null;
  const verifier = admin ? await getVerifierSettings(prisma, info.workspaceId) : null;
  const ai = admin ? await getAiSettings(prisma, info.workspaceId) : null;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {s ? (
        <WorkspaceSettings {...s} physicalAddress={s.physicalAddress ?? ""} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Only workspace owners and admins can change settings.
        </p>
      )}
      {admin && <AiSettings {...(ai ?? {})} />}
      {verifier && <VerifierSettings {...verifier} />}
      <p className="text-sm">
        <Link className="text-primary underline" href="/settings/api-keys">
          API keys
        </Link>
      </p>
    </div>
  );
}
