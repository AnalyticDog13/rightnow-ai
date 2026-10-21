import { deleteList, renameList } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "session-or-apikey", scope: "leads:update", body: z.strictObject({ name: z.string() }) },
  (c) => run(() => renameList(prisma, c.workspaceId, c.userId, c.params.id!, c.body.name)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "leads:delete" }, (c) =>
  run(() => deleteList(prisma, c.workspaceId, c.userId, c.params.id!)),
);
