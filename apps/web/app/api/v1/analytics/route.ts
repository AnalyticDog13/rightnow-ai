import { analytics, analyticsQuery, metricsCsv } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../lib/accounts-http";
import { csvResponse } from "../../../../lib/csv-stream";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "analytics:read",
    query: analyticsQuery.extend({ format: z.enum(["json", "csv"]).default("json") }),
  },
  ({ workspaceId, query: { format, ...q } }) =>
    run(async () => {
      const r = await analytics(prisma, workspaceId, q);
      if (format === "json") return r;
      return csvResponse(
        (async function* () {
          yield metricsCsv(r);
        })(),
        "analytics.csv",
      );
    }),
);
