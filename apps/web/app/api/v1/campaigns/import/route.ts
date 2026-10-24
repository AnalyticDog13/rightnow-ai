import { importCampaign, portableSchema } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  { auth: "session-or-apikey", scope: "campaigns:create", body: portableSchema },
  (c) => run(() => importCampaign(prisma, c.workspaceId, c.userId, c.body)),
);
