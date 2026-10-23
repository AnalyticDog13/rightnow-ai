import {
  AccountError,
  analytics,
  analyticsGroups,
  analyticsQuery,
  metricsCsv,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../lib/accounts-http";
import { csvResponse } from "../../../../lib/csv-stream";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

const by = analyticsQuery.shape.groupBy.unwrap();

export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "analytics:read",
    query: analyticsQuery.extend({
      format: z.enum(["json", "csv"]).default("json"),
      // several groupings from one Event scan, as { [groupBy]: { total, rows } } (JSON only)
      groups: z
        .string()
        .transform((s) => [...new Set(s.split(","))])
        .pipe(z.array(by).min(1))
        .optional(),
    }),
  },
  ({ workspaceId, query: { format, groups, ...q } }) =>
    run(async () => {
      if (groups) {
        if (format === "csv") throw new AccountError(400, "groups_json_only");
        return analyticsGroups(prisma, workspaceId, q, groups);
      }
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
