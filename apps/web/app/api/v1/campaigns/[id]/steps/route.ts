import { addStep, getSequence, stepInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "campaigns:read" }, (c) =>
  run(() => getSequence(prisma, c.workspaceId, c.params.id!)),
);

export const POST = route(
  { auth: "session-or-apikey", scope: "campaigns:update", body: stepInput },
  (c) => run(() => addStep(prisma, c.workspaceId, c.userId, c.params.id!, c.body)),
);
