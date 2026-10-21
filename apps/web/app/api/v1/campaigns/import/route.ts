import { importCampaign } from "@rightnow/core";
import { z } from "zod";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  { auth: "session-or-apikey", scope: "campaigns:create", body: z.unknown() },
  (c) => run(() => importCampaign(prisma, c.workspaceId, c.userId, c.body)),
);
