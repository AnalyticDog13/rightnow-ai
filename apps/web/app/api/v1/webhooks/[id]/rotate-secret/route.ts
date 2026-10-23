import { rotateSecret } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Returns the new secret, shown once. */
export const POST = route({ auth: "session-or-apikey", scope: "webhooks:write" }, (c) =>
  run(() => rotateSecret(prisma, c.workspaceId, c.userId, c.params.id!)),
);
