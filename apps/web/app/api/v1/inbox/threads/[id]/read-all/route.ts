import { readAll } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Marks that thread read (PS-INBOX-23), never the lead other threads. */
export const POST = route({ auth: "session-or-apikey", scope: "inbox:write" }, (c) =>
  run(() => readAll(prisma, c.workspaceId, c.params.id!)),
);
