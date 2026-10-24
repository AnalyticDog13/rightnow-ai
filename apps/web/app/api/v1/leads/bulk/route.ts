import { bulkInput, bulkLeads, bulkValue, createJob, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { HttpError, route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/**
 * Like account bulk: deleting in bulk is ADMIN only, so API keys (which act as MEMBER) cannot.
 * With a `filter` instead of `ids` the work is a `leads_bulk` background job: 202 {jobId} (D45).
 */
export const POST = route(
  { auth: "session-or-apikey", scope: "leads:update", body: bulkInput },
  (c) => {
    if (c.body.action === "delete" && c.role !== "ADMIN" && c.role !== "OWNER")
      throw new HttpError(403, "Forbidden");
    if (c.body.filter) {
      bulkValue(c.body.action, c.body.value); // a bad value is a 400 now, not a failed job later
      return createJob(prisma, c.workspaceId, c.userId, "leads_bulk", c.body).then((r) =>
        Response.json(r, { status: 202 }),
      );
    }
    return run(() => bulkLeads(prisma, systemClock, c.workspaceId, c.body, c.userId));
  },
);
