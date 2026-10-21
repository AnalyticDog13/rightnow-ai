import { exportLeadsCsv, leadQuery } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { csvResponse } from "../../../../../lib/csv-stream";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "leads:read", query: leadQuery },
  async ({ workspaceId, query }) =>
    csvResponse(exportLeadsCsv(prisma, workspaceId, query), "leads.csv"),
);
