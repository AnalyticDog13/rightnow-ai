import { createList, listLists } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "leads:read" }, async (c) => ({
  lists: await listLists(prisma, c.workspaceId),
}));

export const POST = route(
  { auth: "session-or-apikey", scope: "leads:create", body: z.strictObject({ name: z.string() }) },
  (c) => run(() => createList(prisma, c.workspaceId, c.userId, c.body.name)),
);
