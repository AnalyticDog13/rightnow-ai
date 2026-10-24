import {
  createOpportunity,
  listOpportunities,
  pipelineBoard,
  systemClock,
  opportunityInput,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** `?view=board` gives the pipeline columns; otherwise a page of deals. Same filters for both. */
export const GET = route({ auth: "session-or-apikey", scope: "crm:read" }, (c) => {
  const { view, ...q } = Object.fromEntries(new URL(c.req.url).searchParams);
  return view === "board"
    ? pipelineBoard(prisma, c.workspaceId, q)
    : listOpportunities(prisma, c.workspaceId, q);
});

export const POST = route(
  { auth: "session-or-apikey", scope: "crm:create", body: opportunityInput },
  (c) => run(() => createOpportunity(prisma, systemClock, c.workspaceId, c.userId, c.body)),
);
