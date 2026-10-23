import { deleteRule, listRules, ruleInput, updateRule } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { HttpError, route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "automations:read" }, async (c) => {
  const r = (await listRules(prisma, c.workspaceId)).find((x) => x.id === c.params.id);
  if (!r) throw new HttpError(404, "Not found");
  return r;
});

export const PATCH = route(
  { auth: "session-or-apikey", scope: "automations:update", body: ruleInput.partial() },
  (c) =>
    run(() =>
      updateRule(prisma, c.workspaceId, c.userId, c.params.id!, c.body, { scopes: c.scopes }),
    ),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "automations:delete" }, (c) =>
  run(() => deleteRule(prisma, c.workspaceId, c.userId, c.params.id!)),
);
