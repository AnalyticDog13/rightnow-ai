import {
  createProvider,
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

// ADMIN only: API keys act as MEMBER, so they get 403. It sends mail from the account.
export const POST = route(
  { auth: "session", role: "ADMIN", body: placementInput },
  (c) =>
    run(() =>
      startPlacementTest(
        prisma,
        systemClock,
        {
          providerFor: async (a) => createProvider(a, { prisma, clock: systemClock }),
          renderEnv: renderEnv(),
        },
        c.workspaceId,
        actor(c).actorId,
        c.body,
      ),
    ),
);
