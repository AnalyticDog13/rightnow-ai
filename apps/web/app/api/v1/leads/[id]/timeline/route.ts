import { leadTimeline } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "leads:read" }, async (c) => ({
  timeline: await leadTimeline(prisma, c.workspaceId, c.params.id!),
}));
