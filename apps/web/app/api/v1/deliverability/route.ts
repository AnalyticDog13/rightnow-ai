import { deliverabilityOverview, sendableProviders, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../lib/api";
import { getWebEnv } from "../../../../lib/env";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "accounts:read" }, async (c) => ({
  accounts: await deliverabilityOverview(
    prisma,
    c.workspaceId,
    systemClock.now(),
    await sendableProviders(prisma, getWebEnv()),
  ),
}));
