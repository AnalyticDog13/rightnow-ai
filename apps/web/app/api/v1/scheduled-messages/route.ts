import { listScheduled, scheduledQuery } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

/** Send queue and dead-letter view (PS-SEND-17): filter by status (e.g. HELD, FAILED), campaignId, accountId. */
export const GET = route(
  { auth: "session-or-apikey", scope: "campaigns:read", query: scheduledQuery },
  (c) => run(() => listScheduled(prisma, c.workspaceId, c.query)),
);
