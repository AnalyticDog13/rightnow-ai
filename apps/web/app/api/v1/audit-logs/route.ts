import { listAuditLogs } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

/** MEMBER and up (a VIEWER session reads no audit trail); an API key needs `audit:read`. */
export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "audit:read",
    role: "MEMBER",
    query: z.object({
      action: z.string().min(1).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      cursor: z.string().min(1).optional(),
      take: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  (c) => listAuditLogs(prisma, c.workspaceId, c.query),
);
