import { getWorkspaceSettings, systemClock, updateWorkspaceSettings } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session", role: "ADMIN" }, (c) =>
  getWorkspaceSettings(prisma, c.workspaceId),
);

// T13 extends this body with the other workspace settings.
export const PATCH = route({ auth: "session", role: "ADMIN" }, async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  return run(() => updateWorkspaceSettings(prisma, systemClock, c.workspaceId, c.userId, body));
});
