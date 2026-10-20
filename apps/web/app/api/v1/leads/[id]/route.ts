import { getLead, softDeleteLead, systemClock, updateLead, updateLeadInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "leads:read" }, (c) =>
  run(() => getLead(prisma, c.workspaceId, c.params.id!)),
);

export const PATCH = route(
  { auth: "session-or-apikey", scope: "leads:update", body: updateLeadInput },
  (c) => run(() => updateLead(prisma, systemClock, c.workspaceId, c.params.id!, c.body, c.userId)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "leads:delete" }, (c) =>
  run(() => softDeleteLead(prisma, systemClock, c.workspaceId, c.params.id!, c.userId)),
);
