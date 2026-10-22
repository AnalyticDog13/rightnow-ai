import { listThreads, threadFilterSchema } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "inbox:read", query: threadFilterSchema },
  (c) =>
    run(async () => {
      const threads = await listThreads(prisma, c.workspaceId, c.query);
      const last = threads.at(-1);
      return {
        threads,
        nextCursor:
          last && threads.length === c.query.limit
            ? `${last.lastMessageAt.toISOString()}|${last.id}`
            : null,
      };
    }),
);
