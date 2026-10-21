import { bulkDeleteBlocklist } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "blocklist:delete",
    role: "ADMIN",
    body: z.strictObject({ ids: z.array(z.string().min(1)).min(1).max(1000) }),
  },
  (c) => run(() => bulkDeleteBlocklist(prisma, c.workspaceId, c.userId, c.body.ids)),
);
