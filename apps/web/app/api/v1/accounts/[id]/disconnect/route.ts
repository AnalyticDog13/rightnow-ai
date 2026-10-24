import { disconnectAccount } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor, run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  { auth: "session", role: "ADMIN" },
  (c) => run(() => disconnectAccount(prisma, c.workspaceId, c.params.id!, actor(c))),
);
