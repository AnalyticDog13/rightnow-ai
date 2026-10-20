import { mergeLeads, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "leads:update",
    body: z.strictObject({ keepId: z.string().min(1), mergeId: z.string().min(1) }),
  },
  (c) => run(() => mergeLeads(prisma, systemClock, c.workspaceId, c.body, c.userId)),
);
