import { live, systemClock, warmupStats } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "accounts:read",
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
  },
  (c) =>
    run(async () => {
      await live(prisma, c.workspaceId, c.params.id!);
      return { days: await warmupStats(prisma, c.workspaceId, c.params.id!, c.query.days, systemClock.now()) };
    }),
);
