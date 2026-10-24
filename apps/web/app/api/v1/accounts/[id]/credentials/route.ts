import { reconnectSmtpAccount, smtpReconnectInput, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor, run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** SMTP/IMAP reconnect (PS-ACC-08): new credentials for the same account; checks first, 422 and nothing saved when they fail. */
export const POST = route(
  { auth: "session", role: "ADMIN", body: smtpReconnectInput },
  (c) =>
    run(() =>
      reconnectSmtpAccount(
        prisma,
        systemClock,
        {},
        c.workspaceId,
        actor(c).actorId,
        c.params.id!,
        c.body,
      ),
    ),
);
