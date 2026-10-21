import {
  AccountError,
  previewInput,
  previewMessage,
  sendTestEmail,
  systemClock,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { actor, run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { renderEnv } from "../../../../../../lib/launch-deps";

export const dynamic = "force-dynamic";

// Sends one step, rendered for a real lead, to `to` from the campaign's first assigned account. ADMIN and session
// only (like the account test-send). The lead's unsubscribe link is disabled in the copy, so the recipient cannot opt the lead out.
export const POST = route(
  {
    role: "ADMIN",
    body: previewInput.extend({ to: z.string().min(1).max(320), confirmAuthorized: z.boolean() }),
  },
  (c) =>
    run(async () => {
      const { to, confirmAuthorized, ...ref } = c.body;
      const r = await previewMessage(
        prisma,
        c.workspaceId,
        { ...ref, campaignId: c.params.id!, testSafe: true },
        renderEnv(),
      );
      if (r.issues.length) throw new AccountError(422, "preview_has_issues", { issues: r.issues });
      return sendTestEmail(
        prisma,
        systemClock,
        {},
        {
          workspaceId: c.workspaceId,
          actorId: actor(c).actorId,
          accountId: r.accountId,
          to,
          confirmAuthorized,
          content: r,
        },
      );
    }),
);
