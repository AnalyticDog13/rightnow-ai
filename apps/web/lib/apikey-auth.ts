import { hit, scopeAllows, verifyApiKey } from "@rightnow/core";
import type { PrismaClient } from "@rightnow/db";
import { HttpError, type ApiKeyResolver } from "./api";
import { getWebEnv } from "./env";

/** Bearer API key -> workspace access as MEMBER. A key must carry the route's scope (routes without one reject keys). */
export const apiKeyResolver =
  (prisma: PrismaClient): ApiKeyResolver =>
  async (req, scope, also) => {
    const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const key = token ? await verifyApiKey(prisma, token) : null;
    if (!key) return null;
    // D49: every key of a workspace shares one bucket (`limitOrThrow` with this resolver's client)
    const max = getWebEnv().API_RATE_LIMIT_PER_MIN;
    const rl = await hit(prisma, `ws:${key.workspaceId}:api`, max, 60, new Date());
    if (!rl.ok) throw new HttpError(429, "rate_limited", rl.retryAfterSec);
    if (!scope || ![scope, ...(also ?? [])].some((s) => scopeAllows(key.scopes, s)))
      throw new HttpError(403, "Forbidden");
    return { workspaceId: key.workspaceId, role: "MEMBER", scopes: key.scopes };
  };
