import { bulkThreads, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  { auth: "session-or-apikey", scope: "inbox:write", body: z.unknown() },
  (c) => run(() => bulkThreads(prisma, systemClock, c.workspaceId, c.userId, c.body)),
);
