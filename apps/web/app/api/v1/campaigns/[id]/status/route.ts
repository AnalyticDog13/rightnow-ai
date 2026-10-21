import { sendableProviders, systemClock, whyNotSending } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { getWebEnv } from "../../../../../../lib/env";

export const dynamic = "force-dynamic";

// Read-only: VIEWER may read (GET default role); a foreign workspace's campaign is 404.
export const GET = route({ auth: "session-or-apikey", scope: "campaigns:read" }, (c) =>
  run(async () => {
    const env = getWebEnv();
    return whyNotSending(prisma, systemClock, c.workspaceId, c.params.id!, {
      stalenessSec: env.SYNC_MAX_STALENESS_SEC,
      sendable: await sendableProviders(prisma, env),
    });
  }),
);
