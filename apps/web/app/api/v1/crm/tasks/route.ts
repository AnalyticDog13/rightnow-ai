import { createTask, listTasks, systemClock, taskInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "crm:read" }, async (c) => ({
  tasks: await listTasks(
    prisma,
    c.workspaceId,
    Object.fromEntries(new URL(c.req.url).searchParams),
    new Date(),
  ),
}));

export const POST = route(
  { auth: "session-or-apikey", scope: "crm:create", body: taskInput },
  (c) => run(() => createTask(prisma, systemClock, c.workspaceId, c.userId, c.body)),
);
