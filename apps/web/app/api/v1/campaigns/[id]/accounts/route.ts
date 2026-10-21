import { setCampaignAccounts } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PUT = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:update",
    body: z.strictObject({ accountIds: z.array(z.string().min(1)).max(1000) }),
  },
  (c) =>
    run(() =>
      setCampaignAccounts(prisma, c.workspaceId, c.userId, c.params.id!, c.body.accountIds),
    ),
);
