import { prisma } from "@rightnow/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, SessionInfo } from "./api";
import { auth } from "./auth";

/** The signed-in user's workspace (single-workspace deployment: their first membership) and role. */
export async function getSessionInfo(h: Headers): Promise<SessionInfo | null> {
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;
  const m = await prisma.member.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!m) return null;
  return {
    userId: session.user.id,
    workspaceId: m.workspaceId,
    role: m.role.toUpperCase() as Role,
  };
}

/** For pages: redirects to /sign-in. API handlers use route(). */
export async function requireWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  const info = await getSessionInfo(await headers());
  if (!info?.userId) redirect("/sign-in");
  return { userId: info.userId, workspaceId: info.workspaceId };
}
