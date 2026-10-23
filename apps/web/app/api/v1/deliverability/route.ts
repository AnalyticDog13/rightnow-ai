import { deliverabilityOverview, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "accounts:read" }, async (c) => ({
  accounts: await deliverabilityOverview(prisma, c.workspaceId, systemClock.now()),
}));
