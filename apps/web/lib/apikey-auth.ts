import { scopeAllows, verifyApiKey } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db";
import { HttpError, type ApiKeyResolver } from "./api";

/** Bearer API key -> workspace access as MEMBER. A key must carry the route's scope (routes without one reject keys). */
export const apiKeyResolver =
  (prisma: PrismaClient): ApiKeyResolver =>
  async (req, scope) => {
    const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const key = token ? await verifyApiKey(prisma, token) : null;
    if (!key) return null;
    if (!scope || !scopeAllows(key.scopes, scope)) throw new HttpError(403, "Forbidden");
    return { workspaceId: key.workspaceId, role: "MEMBER", scopes: key.scopes };
  };
