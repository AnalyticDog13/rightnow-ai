import { deleteLabel, labelInput, updateLabel } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "session-or-apikey", scope: "leads:update", body: labelInput.partial() },
  (c) => run(() => updateLabel(prisma, c.workspaceId, c.params.id!, c.body, c.userId)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "leads:delete" }, (c) =>
  run(() => deleteLabel(prisma, c.workspaceId, c.params.id!, c.userId)),
);
