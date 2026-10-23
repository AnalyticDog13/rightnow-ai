import { listDeliveries } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** The key's scopes are passed so an API key without inbox:read gets payloads without message bodies (I3). */
export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "webhooks:read",
    query: z.object({
      cursor: z.string().optional(),
      take: z.string().optional(),
      status: z.string().optional(),
    }),
  },
  (c) =>
    run(() => listDeliveries(prisma, c.workspaceId, c.params.id!, c.query, { scopes: c.scopes })),
);
