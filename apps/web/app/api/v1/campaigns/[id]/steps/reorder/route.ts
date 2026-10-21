import { reorderSteps } from "@rightnow/core";
import { z } from "zod";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PUT = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:update",
    body: z.strictObject({
      subsequenceId: z.string().min(1).nullish(),
      stepIds: z.array(z.string().min(1)).max(100),
    }),
  },
  (c) =>
    run(async () => ({
      steps: await reorderSteps(
        prisma,
        c.workspaceId,
        c.userId,
        c.params.id!,
        c.body.subsequenceId ?? null,
        c.body.stepIds,
      ),
    })),
);
