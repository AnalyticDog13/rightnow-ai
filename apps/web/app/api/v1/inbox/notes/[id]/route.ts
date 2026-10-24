import { deleteNote, updateNote, notePatch } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "session-or-apikey", scope: "inbox:write", body: notePatch },
  (c) => run(() => updateNote(prisma, c.workspaceId, c.params.id!, c.body)),
);

export const DELETE = route({ auth: "session-or-apikey", scope: "inbox:write" }, (c) =>
  run(() => deleteNote(prisma, c.workspaceId, c.params.id!)),
);
