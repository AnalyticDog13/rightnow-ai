import { clearBlocklist } from "@rightnow/core";
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
    body: z.strictObject({ confirm: z.string() }),
  },
  (c) => run(() => clearBlocklist(prisma, c.workspaceId, c.userId, c.body.confirm)),
);
