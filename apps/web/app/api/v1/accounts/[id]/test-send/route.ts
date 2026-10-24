import { sendTestEmail, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { actor, run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  {
    auth: "session",
    role: "ADMIN",
    body: z.strictObject({ to: z.string().min(1).max(320), confirmAuthorized: z.boolean() }),
  },
  (c) =>
    run(() =>
      sendTestEmail(
        prisma,
        systemClock,
        {},
        {
          ...c.body,
          workspaceId: c.workspaceId,
          actorId: actor(c).actorId,
          accountId: c.params.id!,
        },
      ),
    ),
);
