import { deleteThread, getThread, systemClock, threadPatch, updateThread } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "inbox:read" }, (c) =>
  run(() => getThread(prisma, c.workspaceId, c.params.id!)),
);

export const PATCH = route(
  { auth: "session-or-apikey", scope: "inbox:write", body: threadPatch },
  (c) =>
    run(() =>
      updateThread(prisma, c.workspaceId, c.userId, c.params.id!, c.body, {
        admin: c.role === "ADMIN" || c.role === "OWNER",
      }),
    ),
);

/** Local only: the provider mailbox is not touched. */
export const DELETE = route({ auth: "session-or-apikey", scope: "inbox:write" }, (c) =>
  run(() => deleteThread(prisma, systemClock, c.workspaceId, c.userId, c.params.id!)),
);
