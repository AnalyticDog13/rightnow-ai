import { createLead, createLeadInput, leadQuery, listLeads } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../lib/accounts-http";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  { auth: "session-or-apikey", scope: "leads:read", query: leadQuery },
  ({ workspaceId, query }) => run(() => listLeads(prisma, workspaceId, query)),
);

export const POST = route(
  { auth: "session-or-apikey", scope: "leads:create", body: createLeadInput },
  // PS-SEC-12: where the contact came from (imports record `csv:<file>`); a key is "api", the UI "manual"
  (c) =>
    run(() =>
      createLead(prisma, c.workspaceId, c.userId, {
        ...c.body,
        source: c.body.source ?? (c.userId ? "manual" : "api"),
      }),
    ),
);
