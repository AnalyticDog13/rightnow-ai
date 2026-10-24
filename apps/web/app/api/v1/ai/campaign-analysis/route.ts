import { analyzeCampaign, campaignAnalysisInput, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";
import { outEnv } from "../../../../../lib/webhook-env";

export const dynamic = "force-dynamic";

/** Model text is stored for review (D47); nothing is sent. 412 `ai_not_configured` while AI is off. */
export const POST = route(
  { auth: "session-or-apikey", scope: "ai:write", body: campaignAnalysisInput },
  (c) => run(() => analyzeCampaign(prisma, systemClock, c.workspaceId, c.body, outEnv())),
);
