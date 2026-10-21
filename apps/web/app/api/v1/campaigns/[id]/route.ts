import { deleteCampaign, getCampaign, campaignPatchSchema, updateCampaign } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "campaigns:read" }, (c) =>
  run(() => getCampaign(prisma, c.workspaceId, c.params.id!)),
);

export const PATCH = route(
  { auth: "session-or-apikey", scope: "campaigns:update", body: campaignPatchSchema },
  (c) => run(() => updateCampaign(prisma, c.workspaceId, c.userId, c.params.id!, c.body)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "campaigns:delete" }, (c) =>
  run(async () => {
    await deleteCampaign(prisma, c.workspaceId, c.userId, c.params.id!);
    return { ok: true };
  }),
);
