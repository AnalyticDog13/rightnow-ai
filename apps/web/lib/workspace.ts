import { prisma } from "@rightnow/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HttpError, type Role, type SessionInfo } from "./api";
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

/** Pages redirect to /sign-in; API callers get HttpError(401). */
export async function requireWorkspace(
  kind: "page" | "api" = "page",
): Promise<{ userId: string; workspaceId: string }> {
  const info = await getSessionInfo(await headers());
  if (!info?.userId) {
    if (kind === "api") throw new HttpError(401, "Unauthorized");
    redirect("/sign-in");
  }
  return { userId: info.userId, workspaceId: info.workspaceId };
}
