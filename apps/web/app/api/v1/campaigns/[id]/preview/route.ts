import { previewInput, previewMessage } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { renderEnv } from "../../../../../../lib/launch-deps";

export const dynamic = "force-dynamic";

// A read: VIEWER may preview. Template and footer problems come back as `issues` (200), not errors.
export const POST = route(
  { auth: "session-or-apikey", scope: "campaigns:read", role: "VIEWER", body: previewInput },
  (c) =>
    run(() =>
      previewMessage(prisma, c.workspaceId, { ...c.body, campaignId: c.params.id! }, renderEnv()),
    ),
);
