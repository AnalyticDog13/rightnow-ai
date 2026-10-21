import { releaseHeld, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** HELD → SCHEDULED. May send a duplicate, so the body must carry `confirm: true` (else 400). */
export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:update",
    body: z.strictObject({ confirm: z.boolean().optional() }),
  },
  (c) => run(() => releaseHeld(prisma, systemClock, c.workspaceId, c.params.id!, c.userId, c.body)),
);
