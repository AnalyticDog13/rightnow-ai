import { createNote, listNotes, noteInput } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "inbox:read",
    query: z.strictObject({
      threadId: z.string().min(1).optional(),
      leadId: z.string().min(1).optional(),
    }),
  },
  async (c) => ({ notes: await listNotes(prisma, c.workspaceId, c.query) }),
);

export const POST = route(
  { auth: "session-or-apikey", scope: "inbox:write", body: noteInput },
  (c) => run(() => createNote(prisma, c.workspaceId, c.userId, c.body)),
);
