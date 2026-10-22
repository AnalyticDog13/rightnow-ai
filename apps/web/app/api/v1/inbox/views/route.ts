import { createView, listViews } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "inbox:read" }, async (c) => ({
  views: await listViews(prisma, c.workspaceId),
}));

export const POST = route(
  { auth: "session-or-apikey", scope: "inbox:write", body: z.unknown() },
  (c) => run(() => createView(prisma, c.workspaceId, c.userId, c.body)),
);
