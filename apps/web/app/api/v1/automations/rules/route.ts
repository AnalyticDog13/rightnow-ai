import { createRule, listRules, ruleInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "automations:read" }, async (c) => ({
  rules: await listRules(prisma, c.workspaceId),
}));

export const POST = route(
  { auth: "session-or-apikey", scope: "automations:create", body: ruleInput },
  (c) => run(() => createRule(prisma, c.workspaceId, c.userId, c.body, { scopes: c.scopes })),
);
