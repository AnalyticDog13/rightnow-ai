import { deleteOpportunity, getOpportunity, systemClock, updateOpportunity } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "crm:read" }, (c) =>
  run(() => getOpportunity(prisma, c.workspaceId, c.params.id!)),
);

export const PATCH = route(
  { auth: "session-or-apikey", scope: "crm:update", body: z.unknown() },
  (c) =>
    run(() =>
      updateOpportunity(prisma, systemClock, c.workspaceId, c.userId, c.params.id!, c.body),
    ),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "crm:delete" }, (c) =>
  run(() => deleteOpportunity(prisma, c.workspaceId, c.userId, c.params.id!)),
);
