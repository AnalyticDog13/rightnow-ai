import { systemClock, testWebhook } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { limitOrThrow } from "../../../../../../lib/ratelimit";
import { outEnv } from "../../../../../../lib/webhook-env";

export const dynamic = "force-dynamic";

/** Sends synchronously to the target, so it is limited per workspace (D49: a key cannot spam the URL). */
export const POST = route({ auth: "session-or-apikey", scope: "webhooks:write" }, async (c) => {
  await limitOrThrow("webhook-test", `ws:${c.workspaceId}`, 10, 60);
  return run(() => testWebhook(prisma, systemClock, c.workspaceId, c.params.id!, outEnv()));
});
