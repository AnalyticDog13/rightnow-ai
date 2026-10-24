import { aiConfigured } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** `{configured}` only: lets every role's UI hide AI buttons while AI is off (the settings route is ADMIN). */
export const GET = route({ auth: "session-or-apikey", scope: "ai:read" }, async (c) => ({
  configured: await aiConfigured(prisma, c.workspaceId),
}));
