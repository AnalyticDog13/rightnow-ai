import { accountAnalytics, analyticsQuery, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "analytics:read", query: analyticsQuery },
  ({ workspaceId, query }) =>
    run(() => accountAnalytics(prisma, workspaceId, query, systemClock.now())),
);
