import { createStage, ensureStages, stageInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "crm:read" }, async (c) => ({
  stages: await ensureStages(prisma, c.workspaceId),
}));

// pipeline configuration is ADMIN and session-only (CLAUDE.md): an API key gets 401
export const POST = route({ auth: "session", role: "ADMIN", body: stageInput }, (c) =>
  run(() => createStage(prisma, c.workspaceId, c.userId, c.body)),
);
