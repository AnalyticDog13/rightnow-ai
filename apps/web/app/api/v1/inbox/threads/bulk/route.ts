import { bulkThreads, systemClock, bulkThreadsInput, requireScopes } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  { auth: "session-or-apikey", scope: "inbox:write", body: bulkThreadsInput },
  (c) =>
    run(() => {
      // m13: these actions change suppression and lead state, not only the thread
      if (c.body.action === "blocklist") requireScopes(c.scopes, "blocklist:create");
      if (c.body.action === "set_interest") requireScopes(c.scopes, "leads:update");
      return bulkThreads(prisma, systemClock, c.workspaceId, c.userId, c.body);
    }),
);
