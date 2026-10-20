import { audit, revokeApiKey } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { HttpError, route } from "../../../../../lib/api";

export const DELETE = route({ role: "ADMIN" }, async ({ workspaceId, userId, params }) => {
  await prisma.$transaction(async (tx) => {
    if (!(await revokeApiKey(tx, workspaceId, params.id!))) throw new HttpError(404, "Not found");
    await audit(tx, { workspaceId, actorId: userId }, "apikey.revoke", params.id);
  });
  return { ok: true };
});
