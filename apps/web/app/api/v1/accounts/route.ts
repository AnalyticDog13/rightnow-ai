import {
  connectSmtpAccount,
  listAccounts,
  listQuery,
  smtpConnectInput,
  systemClock,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor, run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "accounts:read", query: listQuery },
  ({ workspaceId, query }) => listAccounts(prisma, workspaceId, query, { clock: systemClock }),
);

/** SMTP/IMAP connect (PS-ACC-04): checks first, 422 with the checks and nothing saved when they fail. */
export const POST = route(
  { auth: "session", role: "ADMIN", body: smtpConnectInput },
  (c) =>
    run(() => connectSmtpAccount(prisma, systemClock, {}, c.workspaceId, actor(c).actorId, c.body)),
);
