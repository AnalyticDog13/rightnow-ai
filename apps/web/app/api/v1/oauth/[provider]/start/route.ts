import { OAuthStartError, startOAuth, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { HttpError, route } from "../../../../../../lib/api";
import { limitOrThrow } from "../../../../../../lib/ratelimit";

export const dynamic = "force-dynamic";

const body = z.strictObject({
  reconnectAccountId: z.string().min(1).optional(),
  loginHint: z.email().max(320).optional(),
});

export const POST = route(
  { role: "ADMIN", body },
  async ({ workspaceId, userId, body, params }) => {
    await limitOrThrow("oauth-start", `user:${userId}`, 20, 60);
    const provider = z.enum(["google", "microsoft"]).safeParse(params.provider);
    if (!provider.success) throw new HttpError(404, "Unknown provider");
    try {
      return await startOAuth(
        prisma,
        systemClock,
        {},
        { workspaceId, userId: userId!, provider: provider.data, ...body },
      );
    } catch (e) {
      if (e instanceof OAuthStartError)
        throw e.code === "not_configured"
          ? new HttpError(412, "not_configured")
          : new HttpError(404, "Account not found");
      throw e;
    }
  },
);
