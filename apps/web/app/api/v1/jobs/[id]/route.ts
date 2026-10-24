import { getJob } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "jobs:read" }, (c) =>
  run(() => getJob(prisma, c.workspaceId, c.params.id!)),
);
