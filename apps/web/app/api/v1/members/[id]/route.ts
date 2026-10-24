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

/**
 * Order matters (a failure must never leave a removed member with working keys or no audit row): first one transaction
 * revokes their keys and writes the audit row, then the membership goes, then the user. A retry after a failure repeats
 * the idempotent steps (and adds a second audit row).
 */
export const DELETE = route({ role: "ADMIN" }, async (c) => {
  const m = await target(c);
  if (m.userId === c.userId) throw new HttpError(409, "cannot_remove_self");
  const user = await prisma.user.findUnique({ where: { id: m.userId }, select: { email: true } });
  await prisma.$transaction(async (tx) => {
    await tx.apiKey.updateMany({
      where: { workspaceId: c.workspaceId, createdById: m.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // email and userId keep the member's past actions readable once the user row is gone
    await audit(tx, { workspaceId: c.workspaceId, actorId: c.userId }, "member.remove", m.id, {
      role: m.role,
      userId: m.userId,
      email: user?.email ?? null,
    });
  });
  await viaAuth((api) =>
    api.removeMember({
      headers: c.req.headers,
      body: { memberIdOrEmail: m.id, organizationId: c.workspaceId },
    }),
  );
  // single-workspace deployment: the user goes too (sessions cascade). If this fails, the user is left without a
  // membership and the invite accept route deletes it, so the address can still be invited again
  await prisma.user.deleteMany({ where: { id: m.userId, members: { none: {} } } });
});
