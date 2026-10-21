import { deleteVariant, updateVariant, variantPatch } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "session-or-apikey", scope: "campaigns:update", body: variantPatch },
  (c) => run(() => updateVariant(prisma, c.workspaceId, c.userId, c.params.variantId!, c.body)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "campaigns:update" }, (c) =>
  run(async () => {
    await deleteVariant(prisma, c.workspaceId, c.userId, c.params.variantId!);
    return { ok: true };
  }),
);
