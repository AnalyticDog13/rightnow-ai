import { aiSettingsInput, getAiSettings, setAiSettings } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";
import { outEnv } from "../../../../../lib/webhook-env";

export const dynamic = "force-dynamic";

/** `settings` is null while AI is off. The key is never returned: `hasApiKey` only. */
export const GET = route({ auth: "session", role: "ADMIN" }, async (c) => ({
  settings: await getAiSettings(prisma, c.workspaceId),
}));

export const PUT = route({ auth: "session", role: "ADMIN", body: aiSettingsInput }, (c) =>
  run(() => setAiSettings(prisma, c.workspaceId, c.userId, c.body, outEnv())),
);
