import { gdprDeleteLead, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

// ADMIN, session only (API keys act as MEMBER).
export const POST = route({ role: "ADMIN" }, (c) =>
  run(() => gdprDeleteLead(prisma, systemClock, c.workspaceId, c.params.id!, c.userId)),
);
