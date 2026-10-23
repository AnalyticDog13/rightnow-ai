import { createWebhook, listWebhooks, webhookInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";
import { outEnv } from "../../../../lib/webhook-env";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "webhooks:read" }, async (c) => ({
  webhooks: await listWebhooks(prisma, c.workspaceId),
}));

/** The response carries the signing secret: the only time (besides rotate-secret) it is shown. */
export const POST = route(
  { auth: "session-or-apikey", scope: "webhooks:write", body: webhookInput },
  (c) =>
    run(() =>
      createWebhook(prisma, c.workspaceId, c.userId, c.body, outEnv(), { scopes: c.scopes }),
    ),
);
