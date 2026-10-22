import { launchCampaign, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { launchDeps } from "../../../../../../lib/launch-deps";

export const dynamic = "force-dynamic";

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:update",
    body: z.strictObject({ overrideDnsWarnings: z.boolean().optional() }),
  },
  (c) =>
    run(async () =>
      launchCampaign(
        prisma,
        systemClock,
        await launchDeps(c.workspaceId),
        c.workspaceId,
        c.params.id!,
        c.userId,
        c.body,
      ),
    ),
);
