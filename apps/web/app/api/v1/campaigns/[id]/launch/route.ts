import { launchCampaign, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { getWebEnv } from "../../../../../../lib/env";

export const dynamic = "force-dynamic";

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:update",
    body: z.strictObject({ overrideDnsWarnings: z.boolean().optional() }),
  },
  (c) =>
    run(() =>
      launchCampaign(
        prisma,
        systemClock,
        {
          appUrl: getWebEnv().APP_URL,
          // D17: until ProviderVerification exists (T09) only the Fake may send.
          sendable: process.env.MAIL_PROVIDER_FAKE === "1" ? ["GMAIL", "MICROSOFT", "SMTP"] : [],
        },
        c.workspaceId,
        c.params.id!,
        c.userId,
        c.body,
      ),
    ),
);
