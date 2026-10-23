import { listRuns } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "automations:read",
    query: z.object({ cursor: z.string().optional(), take: z.coerce.number().int().optional() }),
  },
  (c) => run(() => listRuns(prisma, c.workspaceId, c.params.id!, c.query)),
);
