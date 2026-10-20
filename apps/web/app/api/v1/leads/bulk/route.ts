import { bulkInput, bulkLeads, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { HttpError, route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Like account bulk: deleting in bulk is ADMIN only, so API keys (which act as MEMBER) cannot. */
export const POST = route(
  { auth: "session-or-apikey", scope: "leads:update", body: bulkInput },
  (c) => {
    if (c.body.action === "delete" && c.role !== "ADMIN" && c.role !== "OWNER")
      throw new HttpError(403, "Forbidden");
    return run(() => bulkLeads(prisma, systemClock, c.workspaceId, c.body, c.userId));
  },
);
