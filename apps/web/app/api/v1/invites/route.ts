import { audit } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { route } from "../../../../lib/api";
import { viaAuth } from "../../../../lib/auth-call";

export const dynamic = "force-dynamic";

/** D50: ADMIN and session-only (an API key acts as MEMBER). */
export const GET = route({ role: "ADMIN" }, async (c) => ({
  invites: await prisma.invitation.findMany({
    where: { workspaceId: c.workspaceId, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
  }),
}));

const body = z.strictObject({
  email: z.email().max(254),
  role: z.enum(["admin", "member", "viewer"]),
});

/** No mail is sent: the admin copies the link `/invite/<id>`. */
export const POST = route({ role: "ADMIN", body }, async (c) => {
  const inv = await viaAuth((api) =>
    api.createInvitation({
      headers: c.req.headers,
      body: { email: c.body.email, role: c.body.role, organizationId: c.workspaceId },
    }),
  );
  await audit(
    prisma,
    { workspaceId: c.workspaceId, actorId: c.userId },
    "member.invite",
    inv.email,
    {
      role: c.body.role,
    },
  ); // the invitation id is the secret that lets anyone join: it never goes into an audit row
  return { id: inv.id, expiresAt: inv.expiresAt };
});
