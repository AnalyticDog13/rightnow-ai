import { deleteTask, systemClock, updateTask } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "session-or-apikey", scope: "crm:update", body: z.unknown() },
  (c) => run(() => updateTask(prisma, systemClock, c.workspaceId, c.userId, c.params.id!, c.body)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "crm:delete" }, (c) =>
  run(() => deleteTask(prisma, c.workspaceId, c.userId, c.params.id!)),
);
