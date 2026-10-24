import { listJobs } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "jobs:read",
    query: z.object({
      cursor: z.string().min(1).optional(),
      take: z.coerce.number().int().min(1).max(100).optional(),
      status: z.enum(["PENDING", "RUNNING", "DONE", "FAILED"]).optional(),
    }),
  },
  (c) => listJobs(prisma, c.workspaceId, c.query),
);
