import { audit } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { HttpError, route } from "../../../../../lib/api";
import { viaAuth } from "../../../../../lib/auth-call";

export const dynamic = "force-dynamic";

/** The member in this workspace, never the OWNER (D50: the OWNER's role and membership are fixed). */
async function target(c: { workspaceId: string; params: Record<string, string | undefined> }) {
  const m = await prisma.member.findFirst({
    where: { id: c.params.id, workspaceId: c.workspaceId },
  });
  if (!m) throw new HttpError(404, "Not found");
  if (m.role === "owner") throw new HttpError(409, "owner_immutable");
  return m;
}

export const PATCH = route(
  { role: "ADMIN", body: z.strictObject({ role: z.enum(["admin", "member", "viewer"]) }) },
  async (c) => {
    const m = await target(c);
    await viaAuth((api) =>
      api.updateMemberRole({
        headers: c.req.headers,
        body: { memberId: m.id, role: c.body.role, organizationId: c.workspaceId },
      }),
    );
    await audit(prisma, { workspaceId: c.workspaceId, actorId: c.userId }, "member.role", m.id, {
      from: m.role,
      to: c.body.role,
    });
  },
);

export const DELETE = route({ role: "ADMIN" }, async (c) => {
  const m = await target(c);
  if (m.userId === c.userId) throw new HttpError(409, "cannot_remove_self");
  await viaAuth((api) =>
    api.removeMember({
      headers: c.req.headers,
      body: { memberIdOrEmail: m.id, organizationId: c.workspaceId },
    }),
  );
  await prisma.$transaction(async (tx) => {
    await tx.apiKey.updateMany({
      where: { workspaceId: c.workspaceId, createdById: m.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // single-workspace deployment: the user goes too (sessions cascade), so the address can be invited again
    await tx.user.deleteMany({ where: { id: m.userId, members: { none: {} } } });
    await audit(tx, { workspaceId: c.workspaceId, actorId: c.userId }, "member.remove", m.id, {
      role: m.role,
    });
  });
});
