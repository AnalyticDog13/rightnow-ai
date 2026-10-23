import { builtinRules } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "automations:read" }, async (c) => ({
  builtin: await builtinRules(prisma, c.workspaceId),
}));
