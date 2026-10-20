import { prisma } from "@rightnow/db";
import type { ReactNode } from "react";
import { AppShell } from "../../components/app-shell";
import { requireWorkspace } from "../../lib/workspace";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { workspaceId } = await requireWorkspace();
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true },
  });
  return <AppShell workspaceName={ws.name}>{children}</AppShell>;
}
