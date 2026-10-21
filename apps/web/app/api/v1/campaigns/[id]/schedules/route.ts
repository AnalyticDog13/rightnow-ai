import { schedulesSchema, setSchedules } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PUT = route(
  { auth: "session-or-apikey", scope: "campaigns:update", body: schedulesSchema },
  (c) =>
    run(async () => ({
      schedules: await setSchedules(prisma, c.workspaceId, c.userId, c.params.id!, c.body),
    })),
);
