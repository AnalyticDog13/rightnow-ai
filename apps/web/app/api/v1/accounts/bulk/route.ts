import { bulkApply, bulkSchema } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor } from "../../../../../lib/accounts-http";
import { HttpError, route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  { auth: "session-or-apikey", scope: "accounts:update", body: bulkSchema },
  async (c) => {
    // Deleting needs the same role as the single delete.
    if (c.body.action === "delete" && c.role !== "ADMIN" && c.role !== "OWNER")
      throw new HttpError(403, "Forbidden");
    return { results: await bulkApply(prisma, c.workspaceId, c.body, actor(c)) };
  },
);
