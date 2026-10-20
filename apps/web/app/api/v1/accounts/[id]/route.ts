import { getAccount, patchSchema, softDeleteAccount, updateAccount } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { actor, run } from "../../../../../lib/accounts-http";
import { HttpError, route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "accounts:read" },
  async ({ workspaceId, params }) => {
    const a = await getAccount(prisma, workspaceId, params.id!);
    if (!a) throw new HttpError(404, "Not found");
    return a;
  },
);

export const PATCH = route(
  { auth: "session-or-apikey", scope: "accounts:update", body: patchSchema },
  (c) => run(() => updateAccount(prisma, c.workspaceId, c.params.id!, c.body, actor(c))),
);

export const DELETE = route(
  { auth: "session-or-apikey", scope: "accounts:delete", role: "ADMIN" },
  (c) => run(() => softDeleteAccount(prisma, c.workspaceId, c.params.id!, actor(c))),
);
