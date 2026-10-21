import { addBlocklist, blocklistQuery, listBlocklist } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "blocklist:read", query: blocklistQuery },
  (c) => run(() => listBlocklist(prisma, c.workspaceId, c.query)),
);

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "blocklist:create",
    body: z.strictObject({ values: z.array(z.string().max(320)).min(1).max(1000) }),
  },
  (c) => run(() => addBlocklist(prisma, c.workspaceId, c.userId, c.body.values)),
);
