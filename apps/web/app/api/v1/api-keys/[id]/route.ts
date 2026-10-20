import { audit, revokeApiKey } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { HttpError, route } from "../../../../../lib/api";

export const DELETE = route({ role: "ADMIN" }, async ({ workspaceId, userId, req }) => {
  const id = new URL(req.url).pathname.split("/").pop()!;
  if (!(await revokeApiKey(prisma, workspaceId, id))) throw new HttpError(404, "Not found");
  await audit(prisma, { workspaceId, actorId: userId }, "apikey.revoke", id);
  return { ok: true };
});
