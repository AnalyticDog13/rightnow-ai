import { MAX_BLOCKLIST_CSV_BYTES, importBlocklistCsv } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";
import { readUpload } from "../../../../../lib/upload";

export const dynamic = "force-dynamic";

/** multipart: `file` (CSV, one value per row, max 5 MB). */
export const POST = route({ auth: "session-or-apikey", scope: "blocklist:create" }, async (c) => {
  const up = await readUpload(c.req, MAX_BLOCKLIST_CSV_BYTES);
  return run(() => importBlocklistCsv(prisma, c.workspaceId, c.userId, up.data));
});
