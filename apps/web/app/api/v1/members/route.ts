import { prisma } from "@rightnow/db";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

/** Explicit selects only: no password hash, session or token column can reach the response. */
export const GET = route({ auth: "session-or-apikey", scope: "workspace:read" }, async (c) => {
  const rows = await prisma.member.findMany({
    where: { workspaceId: c.workspaceId },
    select: { id: true, userId: true, role: true, user: { select: { email: true, name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return {
    members: rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
    })),
  };
});
