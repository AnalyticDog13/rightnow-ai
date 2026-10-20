import { listAccounts, listQuery, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "accounts:read", query: listQuery },
  ({ workspaceId, query }) => listAccounts(prisma, workspaceId, query, { clock: systemClock }),
);
