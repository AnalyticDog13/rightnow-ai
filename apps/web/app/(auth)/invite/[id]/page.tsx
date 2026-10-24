import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "../../../../components/ui/card";
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
    <Card className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Join a workspace</h1>
      {ok ? (
        <>
          <p className="text-sm text-muted-foreground">
            You were invited to {inv.workspace.name}. Choose a name and password to continue.
          </p>
          <InviteForm invitationId={id} email={inv.email} />
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          This invite link is not valid: it may have expired, been canceled or already been used.
          Ask the workspace admin for a new one, or{" "}
          <Link className="text-primary underline" href="/sign-in">
            sign in
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
