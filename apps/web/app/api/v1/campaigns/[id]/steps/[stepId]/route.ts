import { deleteStep, stepPatch, updateStep } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "session-or-apikey", scope: "campaigns:update", body: stepPatch },
  (c) => run(() => updateStep(prisma, c.workspaceId, c.userId, c.params.stepId!, c.body)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "campaigns:update" }, (c) =>
  run(async () => {
    await deleteStep(prisma, c.workspaceId, c.userId, c.params.stepId!);
    return { ok: true };
  }),
);
