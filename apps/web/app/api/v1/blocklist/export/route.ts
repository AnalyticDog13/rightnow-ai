import { exportBlocklistCsv } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../../lib/api";
import { csvResponse } from "../../../../../lib/csv-stream";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "blocklist:read" }, async (c) =>
  csvResponse(exportBlocklistCsv(prisma, c.workspaceId), "blocklist.csv"),
);
