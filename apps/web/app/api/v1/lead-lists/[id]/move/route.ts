import { moveLeads } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Moves leads from the list in the URL to `toListId`. */
export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "leads:update",
    body: z.strictObject({
      leadIds: z.array(z.string().min(1)).min(1).max(1000),
      toListId: z.string().min(1),
    }),
  },
  (c) =>
    run(() => moveLeads(prisma, c.workspaceId, c.userId, { ...c.body, fromListId: c.params.id! })),
);
