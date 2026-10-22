import { runDiagnostics } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor, run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { resolver } from "../../../../../../lib/dns";

export const dynamic = "force-dynamic";

export const POST = route({ auth: "session-or-apikey", scope: "accounts:update" }, (c) =>
  run(() => runDiagnostics(prisma, c.workspaceId, c.params.id!, { ...actor(c), resolver })),
);
