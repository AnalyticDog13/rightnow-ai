import { prisma } from "@rightnow/db";
import { HttpError, route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "leads:read" }, async (c) => {
  const j = await prisma.importJob.findFirst({
    where: { id: c.params.id!, workspaceId: c.workspaceId },
    select: {
      id: true,
      status: true,
      progress: true,
      total: true,
      imported: true,
      attached: true,
      skipped: true,
      error: true,
      finishedAt: true,
    },
  });
  if (!j) throw new HttpError(404, "Not found");
  return j;
});
