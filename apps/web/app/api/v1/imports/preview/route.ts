import { mappingSchema, previewImport } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";
import { readUpload } from "../../../../../lib/upload";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "session-or-apikey", scope: "leads:create" }, async (c) => {
  const up = await readUpload(c.req);
  const mapping = up.json("mapping");
  return run(() =>
    previewImport(
      prisma,
      c.workspaceId,
      up.data,
      mapping ? mappingSchema.parse(mapping) : undefined,
    ),
  );
});
