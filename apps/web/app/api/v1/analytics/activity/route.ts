import { analyticsQuery, checked, exportActivityCsv, rangeDays } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { csvResponse } from "../../../../../lib/csv-stream";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "analytics:read", query: analyticsQuery },
  // range and zone are checked before the stream starts: a bad one is a 400, not a broken download
  ({ workspaceId, query }) =>
    run(async () => {
      rangeDays(query);
      await checked(prisma.$queryRaw`SELECT now() AT TIME ZONE ${query.tz}`);
      return csvResponse(exportActivityCsv(prisma, workspaceId, query), "activity.csv");
    }),
);
