import { LAWFUL_BASES, createImport, mappingSchema, requireScopes } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";
import { readUpload } from "../../../../lib/upload";

export const dynamic = "force-dynamic";

const body = z.strictObject({
  mapping: mappingSchema,
  options: z.record(z.string(), z.unknown()).default({}),
  confirmedAuthorized: z.boolean(),
  source: z.string().max(200).optional(),
  lawfulBasis: z.literal(LAWFUL_BASES),
});

/** multipart: `file` (CSV) and `options` (JSON: mapping, confirmedAuthorized, lawfulBasis, source, options). */
export const POST = route({ auth: "session-or-apikey", scope: "leads:create" }, async (c) => {
  const up = await readUpload(c.req);
  const b = body.parse(up.json("options"));
  const r = await run(() => {
    // enrolling into a campaign is what starts mail going out
    if (b.options.campaignId) requireScopes(c.scopes, "campaigns:update");
    return createImport(prisma, c.workspaceId, c.userId, {
      ...b,
      fileName: up.fileName,
      data: up.data,
    });
  });
  return r instanceof Response ? r : Response.json(r, { status: 202 });
});
