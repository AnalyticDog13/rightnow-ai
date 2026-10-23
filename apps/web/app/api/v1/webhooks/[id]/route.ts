import { deleteWebhook, getWebhook, updateWebhook, webhookInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";
import { outEnv } from "../../../../../lib/webhook-env";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "webhooks:read" }, (c) =>
  run(() => getWebhook(prisma, c.workspaceId, c.params.id!)),
);

export const PATCH = route(
  { auth: "session-or-apikey", scope: "webhooks:write", body: webhookInput.partial() },
  (c) =>
    run(() =>
      updateWebhook(prisma, c.workspaceId, c.userId, c.params.id!, c.body, outEnv(), {
        scopes: c.scopes,
      }),
    ),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "webhooks:write" }, (c) =>
  run(() => deleteWebhook(prisma, c.workspaceId, c.userId, c.params.id!)),
);
