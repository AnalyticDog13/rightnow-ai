import { createView, listViews, requireViewScope, viewInput, type ViewScope } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

// The key scope depends on the view's scope: the route admits `inbox:*` or `leads:*` keys and the handler enforces
// the one that applies (`requireViewScope`). The openapi audit reads `scope`, the inbox default.
export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "inbox:read",
    alsoScopes: ["leads:read"],
    query: z.object({ scope: z.enum(["inbox", "leads"]).default("inbox") }),
  },
  (c) =>
    run(async () => {
      requireViewScope(c.scopes, c.query.scope as ViewScope, "read");
      return { views: await listViews(prisma, c.workspaceId, c.query.scope) };
    }),
);

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "inbox:write",
    alsoScopes: ["leads:create"],
    body: viewInput,
  },
  (c) =>
    run(async () => {
      requireViewScope(c.scopes, c.body.scope, "create");
      return createView(prisma, c.workspaceId, c.userId, c.body);
    }),
);
