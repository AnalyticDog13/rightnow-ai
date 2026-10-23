import { cancelRewarm, createProvider, getAccount, rewarmInput, startRewarm } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor, run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { resolver } from "../../../../../../lib/dns";

export const dynamic = "force-dynamic";

// PS-REWARM-03/04: start (connection and DNS rechecked first) and cancel. MEMBER and API keys may (accounts:update).
export const POST = route(
  { auth: "session-or-apikey", scope: "accounts:update", body: rewarmInput },
  (c) =>
    run(async () => {
      const o = actor(c);
      const { warnings } = await startRewarm(
        prisma,
        o.clock,
        { providerFor: async (a) => createProvider(a, { prisma, clock: o.clock }), resolver },
        c.workspaceId,
        o.actorId,
        c.params.id!,
        c.body,
      );
      return { account: await getAccount(prisma, c.workspaceId, c.params.id!, o), warnings };
    }),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "accounts:update" }, (c) =>
  run(async () => {
    const o = actor(c);
    await cancelRewarm(prisma, o.clock, c.workspaceId, o.actorId, c.params.id!);
    return { account: await getAccount(prisma, c.workspaceId, c.params.id!, o) };
  }),
);
