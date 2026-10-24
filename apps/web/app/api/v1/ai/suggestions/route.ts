import { listSuggestions, suggestionQuery } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "ai:read", query: suggestionQuery },
  (c) => listSuggestions(prisma, c.workspaceId, c.query, { scopes: c.scopes }),
);
