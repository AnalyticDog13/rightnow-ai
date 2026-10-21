import { enrollLeads, leadQuery, listLeads, systemClock } from "@rightnow/core";
import { z } from "zod";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "campaigns:read", query: leadQuery },
  (c) => run(() => listLeads(prisma, c.workspaceId, { ...c.query, campaignId: c.params.id! })),
);

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:update",
    body: z.strictObject({
      leadIds: z.array(z.string().min(1)).max(100_000).optional(),
      listId: z.string().min(1).optional(),
      filter: leadQuery.optional(),
      allowDuplicates: z.boolean().optional(),
    }),
  },
  (c) => run(() => enrollLeads(prisma, systemClock, c.workspaceId, c.params.id!, c.body, c.userId)),
);
