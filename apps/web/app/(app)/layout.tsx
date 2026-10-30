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
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-skip) focus:rounded-sm focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <AppShell workspaceName={ws.name}>{children}</AppShell>
    </>
  );
}
