import { systemClock, testWebhook } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { outEnv } from "../../../../../../lib/webhook-env";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "session-or-apikey", scope: "webhooks:write" }, (c) =>
  run(() => testWebhook(prisma, systemClock, c.workspaceId, c.params.id!, outEnv())),
);
