import { addToList, removeFromList } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

const body = z.strictObject({ leadIds: z.array(z.string().min(1)).min(1).max(1000) });

export const POST = route({ auth: "session-or-apikey", scope: "leads:update", body }, (c) =>
  run(() => addToList(prisma, c.workspaceId, c.userId, c.params.id!, c.body.leadIds)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "leads:update", body }, (c) =>
  run(() => removeFromList(prisma, c.workspaceId, c.userId, c.params.id!, c.body.leadIds)),
);
