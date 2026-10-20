import { pauseAccount } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { actor, run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "accounts:update",
    body: z.strictObject({ until: z.iso.datetime().optional() }),
  },
  (c) =>
    run(() =>
      pauseAccount(
        prisma,
        c.workspaceId,
        c.params.id!,
        c.body.until ? new Date(c.body.until) : undefined,
        actor(c),
      ),
    ),
);
