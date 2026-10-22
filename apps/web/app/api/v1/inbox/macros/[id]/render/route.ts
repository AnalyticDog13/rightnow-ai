import { renderMacro } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** The macro filled in for a thread: the thread lead and sending mailbox. Read-only, so a viewer may use it. */
export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "inbox:read",
    role: "VIEWER",
    body: z.strictObject({ threadId: z.string().min(1) }),
  },
  (c) => run(() => renderMacro(prisma, c.workspaceId, c.params.id!, c.body.threadId)),
);
