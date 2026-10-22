import { deleteMacro, updateMacro } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "session-or-apikey", scope: "inbox:write", body: z.unknown() },
  (c) => run(() => updateMacro(prisma, c.workspaceId, c.userId, c.params.id!, c.body)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "inbox:write" }, (c) =>
  run(() => deleteMacro(prisma, c.workspaceId, c.userId, c.params.id!)),
);
