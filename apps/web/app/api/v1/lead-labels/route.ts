import { createLabel, labelInput, listLabels } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "leads:read" }, async (c) => ({
  labels: await listLabels(prisma, c.workspaceId),
}));

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "leads:create",
    body: labelInput.partial({ positive: true, aiDescription: true }),
  },
  (c) => run(() => createLabel(prisma, c.workspaceId, c.userId, c.body)),
);
