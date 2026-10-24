import { getAiSettings, getVerifierSettings, getWorkspaceSettings } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AiSettings } from "../../../components/ai-settings";
import { AuditLog } from "../../../components/audit-log";
import { MembersSettings } from "../../../components/members-settings";
import { SecuritySettings } from "../../../components/security-settings";
import { VerifierSettings } from "../../../components/verifier-settings";
import { WorkspaceSettings } from "../../../components/workspace-settings";
import { getSessionInfo } from "../../../lib/workspace";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; cursor?: string }>;
}) {
  const info = await getSessionInfo(await headers());
  if (!info?.userId) redirect("/sign-in");
  const ws = info.workspaceId;
  const admin = info.role === "OWNER" || info.role === "ADMIN";
  const s = admin ? await getWorkspaceSettings(prisma, ws) : null;
  const verifier = admin ? await getVerifierSettings(prisma, ws) : null;
  const ai = admin ? await getAiSettings(prisma, ws) : null;
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: info.userId },
    select: { twoFactorEnabled: true },
  });
  const [members, invites] = admin
    ? await Promise.all([
        prisma.member.findMany({
          where: { workspaceId: ws },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            userId: true,
            role: true,
            user: { select: { name: true, email: true } },
          },
        }),
        prisma.invitation.findMany({
          where: { workspaceId: ws, status: "pending", expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, role: true, expiresAt: true },
        }),
      ])
    : [[], []];
  const q = await searchParams;
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
      {admin && (
        <MembersSettings
          members={members.map((m) => ({
            id: m.id,
            name: m.user.name,
            email: m.user.email,
            role: m.role,
            self: m.userId === info.userId,
          }))}
          invites={invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))}
        />
      )}
      <SecuritySettings enabled={me.twoFactorEnabled} />
      {admin && <AiSettings {...(ai ?? {})} />}
      {verifier && <VerifierSettings {...verifier} />}
      {info.role !== "VIEWER" && <AuditLog workspaceId={ws} action={q.action} cursor={q.cursor} />}
      <p className="text-sm">
        <Link className="text-primary underline" href="/settings/api-keys">
          API keys
        </Link>
      </p>
    </div>
  );
}
