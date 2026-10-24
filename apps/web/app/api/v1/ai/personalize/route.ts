import { createJob, requireScopes, personalizeInput, requireAi } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** 202 {jobId}: the `ai_personalize` background job stores one PENDING suggestion per lead (D45, D47). */
export const POST = route(
  { auth: "session-or-apikey", scope: "ai:write", body: personalizeInput },
  (c) =>
    run(async () => {
      requireScopes(c.scopes, "leads:read"); // I1: the job reads the leads
      await requireAi(prisma, c.workspaceId);
      const job = await createJob(prisma, c.workspaceId, c.userId, "ai_personalize", c.body);
      return Response.json(job, { status: 202 });
    }),
);
