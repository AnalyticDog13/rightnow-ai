import {
  deleteView,
  requireViewScope,
  updateView,
  viewInput,
  type ViewScope,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

// As for the list route: the stored `scope` of the view decides which key scope applies.
const check = async (
  ws: string,
  id: string,
  scopes: string[] | undefined,
  verb: "update" | "delete",
) => {
  const v = await prisma.inboxView.findFirst({
    where: { id, workspaceId: ws },
    select: { scope: true },
  });
  if (v) requireViewScope(scopes, v.scope as ViewScope, verb);
};

export const PATCH = route(
  {
    auth: "session-or-apikey",
    scope: "inbox:write",
    alsoScopes: ["leads:update"],
    body: viewInput.partial(),
  },
  (c) =>
    run(async () => {
      await check(c.workspaceId, c.params.id!, c.scopes, "update");
      return updateView(prisma, c.workspaceId, c.userId, c.params.id!, c.body);
    }),
);

export const DELETE = route(
  { auth: "session-or-apikey", scope: "inbox:write", alsoScopes: ["leads:delete"] },
  (c) =>
    run(async () => {
      await check(c.workspaceId, c.params.id!, c.scopes, "delete");
      return deleteView(prisma, c.workspaceId, c.userId, c.params.id!);
    }),
);
