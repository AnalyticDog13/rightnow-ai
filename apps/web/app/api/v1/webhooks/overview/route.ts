import { webhookOverview } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Delivered vs failed attempts per day (workspace timezone) between `from` and `to` (YYYY-MM-DD). */
export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "webhooks:read",
    query: z.object({ from: z.string(), to: z.string() }),
  },
  (c) => run(async () => ({ days: await webhookOverview(prisma, c.workspaceId, c.query) })),
);
