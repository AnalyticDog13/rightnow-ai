import { createCampaign, campaignCreateSchema, listCampaigns } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as const;

export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:read",
    query: z.strictObject({
      status: z.enum([...STATUSES, "ACCOUNTS_UNHEALTHY", "BOUNCE_PROTECT"]).optional(),
    }),
  },
  async (c) => ({ campaigns: await listCampaigns(prisma, c.workspaceId, c.query.status) }),
);

export const POST = route(
  { auth: "session-or-apikey", scope: "campaigns:create", body: campaignCreateSchema },
  (c) => run(() => createCampaign(prisma, c.workspaceId, c.userId, c.body)),
);
