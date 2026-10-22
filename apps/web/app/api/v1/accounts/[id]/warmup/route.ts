import {
  live,
  sendableProviders,
  systemClock,
  updateWarmup,
  warmupPatchSchema,
  warmupView,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor, run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { getWebEnv } from "../../../../../../lib/env";

export const dynamic = "force-dynamic";

const view = async (ws: string, id: string) => {
  const a = await live(prisma, ws, id);
  return warmupView(prisma, a, systemClock.now(), await sendableProviders(prisma, getWebEnv()));
};

export const GET = route({ auth: "session-or-apikey", scope: "accounts:read" }, (c) =>
  run(() => view(c.workspaceId, c.params.id!)),
);

export const PATCH = route(
  { auth: "session-or-apikey", scope: "accounts:update", body: warmupPatchSchema },
  (c) =>
    run(async () => {
      const { warnings } = await updateWarmup(
        prisma,
        await live(prisma, c.workspaceId, c.params.id!),
        c.body,
        { clock: systemClock, actorId: actor(c).actorId },
      );
      return { ...(await view(c.workspaceId, c.params.id!)), warnings };
    }),
);
