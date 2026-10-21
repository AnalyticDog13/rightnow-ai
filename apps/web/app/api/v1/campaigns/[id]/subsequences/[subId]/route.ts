import { setSubsequenceActive } from "@rightnow/core";
import { z } from "zod";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:update",
    body: z.strictObject({ active: z.boolean() }),
  },
  (c) =>
    run(() =>
      setSubsequenceActive(prisma, c.workspaceId, c.userId, c.params.subId!, c.body.active),
    ),
);
