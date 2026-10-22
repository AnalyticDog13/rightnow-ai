import { attachLead, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "inbox:write",
    body: z.strictObject({ leadId: z.string().min(1) }),
  },
  (c) =>
    run(() =>
      attachLead(prisma, systemClock, c.workspaceId, c.userId, c.params.id!, c.body.leadId),
    ),
);
