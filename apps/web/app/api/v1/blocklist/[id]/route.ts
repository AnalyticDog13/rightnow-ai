import { removeBlocklist } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** ADMIN only (API keys act as MEMBER, so they cannot). `?confirm=1` is needed for unsubscribes, complaints and erasure records. */
export const DELETE = route(
  {
    auth: "session-or-apikey",
    scope: "blocklist:delete",
    role: "ADMIN",
    query: z.object({ confirm: z.stringbool().optional() }),
  },
  (c) =>
    run(() =>
      removeBlocklist(prisma, c.workspaceId, c.userId, c.params.id!, { confirm: c.query.confirm }),
    ),
);
