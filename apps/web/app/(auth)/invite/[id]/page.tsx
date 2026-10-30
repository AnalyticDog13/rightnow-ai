import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "../../../../components/callout";
import { InviteForm } from "../../../../components/invite-form";

export const metadata: Metadata = { title: "Join workspace" };
export const dynamic = "force-dynamic";

export default async function Invite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await prisma.invitation.findUnique({
    where: { id },
    select: { email: true, status: true, expiresAt: true, workspace: { select: { name: true } } },
  });
  const ok = inv && inv.status === "pending" && inv.expiresAt.getTime() > Date.now();
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 md:p-8">
      <h1 className="text-xl/7 font-semibold">Join a workspace</h1>
      {ok ? (
        <>
          <p className="text-[13px]/[18px] text-fg-muted">
            You were invited to{" "}
            <strong className="font-medium text-fg">{inv.workspace.name}</strong>. Choose a name and
            password to continue.
          </p>
          <InviteForm invitationId={id} email={inv.email} />
        </>
      ) : (
        <Callout tone="neutral" role="status">
          This invite link is not valid: it may have expired, been canceled or already been used.
          Ask the workspace admin for a new one, or{" "}
          <Link className="text-signal underline underline-offset-2" href="/sign-in">
            sign in
          </Link>
          .
        </Callout>
      )}
    </div>
  );
}
