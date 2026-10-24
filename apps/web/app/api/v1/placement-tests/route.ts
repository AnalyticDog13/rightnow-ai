import {
  listPlacementTests,
  placementInput,
  startPlacementTest,
  systemClock,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor, run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";
import { renderEnv } from "../../../../lib/launch-deps";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "accounts:read" }, (c) =>
  run(async () => ({ tests: await listPlacementTests(prisma, c.workspaceId) })),
);

// ADMIN only: API keys act as MEMBER, so they get 403. It sends mail from the account, in the `placement_run` job:
// 202 {id, jobId} (D51). At most 3 runs per account per hour: 429.
export const POST = route({ auth: "session", role: "ADMIN", body: placementInput }, (c) =>
  run(async () =>
    Response.json(
      await startPlacementTest(
        prisma,
        systemClock,
        { renderEnv: renderEnv() },
        c.workspaceId,
        actor(c).actorId,
        c.body,
      ),
      { status: 202 },
    ),
  ),
);
