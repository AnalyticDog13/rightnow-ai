import { audit } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { HttpError, route } from "../../../../../lib/api";
import { viaAuth } from "../../../../../lib/auth-call";

export const dynamic = "force-dynamic";

export const DELETE = route({ role: "ADMIN" }, async (c) => {
  const invitationId = c.params.id!;
  if (!(await prisma.invitation.count({ where: { id: invitationId, workspaceId: c.workspaceId } })))
    throw new HttpError(404, "Not found");
  await viaAuth((api) => api.cancelInvitation({ headers: c.req.headers, body: { invitationId } }));
  await audit(
    prisma,
    { workspaceId: c.workspaceId, actorId: c.userId },
    "member.invite_cancel",
    invitationId,
  );
});
