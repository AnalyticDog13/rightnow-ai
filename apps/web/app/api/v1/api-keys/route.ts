import { API_SCOPES, audit, createApiKey } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ role: "ADMIN" }, async ({ workspaceId }) => ({
  keys: await prisma.apiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  }),
}));

const body = z.strictObject({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

/** The token is in this response only; it cannot be retrieved later. */
export const POST = route({ role: "ADMIN", body }, async ({ workspaceId, userId, body }) => {
  return prisma.$transaction(async (tx) => {
    const { id, token } = await createApiKey(tx, workspaceId, body.name, body.scopes, userId);
    await audit(tx, { workspaceId, actorId: userId }, "apikey.create", id, {
      name: body.name,
      scopes: body.scopes,
    });
    return { id, token };
  });
});
