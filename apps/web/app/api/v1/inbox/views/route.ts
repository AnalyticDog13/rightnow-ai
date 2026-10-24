import { createView, listViews, viewInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "inbox:read",
    query: z.object({ scope: z.enum(["inbox", "leads"]).default("inbox") }),
  },
  async (c) => ({ views: await listViews(prisma, c.workspaceId, c.query.scope) }),
);

export const POST = route(
  { auth: "session-or-apikey", scope: "inbox:write", body: viewInput },
  (c) => run(() => createView(prisma, c.workspaceId, c.userId, c.body)),
);
