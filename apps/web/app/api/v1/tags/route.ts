import { prisma } from "@rightnow/db";
import { z } from "zod";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

/** The distinct tags in use on accounts, campaigns or leads (not deleted), sorted. */
export const GET = route(
  {
    auth: "session-or-apikey",
    scope: "workspace:read",
    query: z.object({ kind: z.enum(["account", "campaign", "lead"]) }),
  },
  async (c) => {
    const ws = c.workspaceId;
    const rows =
      c.query.kind === "account"
        ? await prisma.$queryRaw<
            { tag: string }[]
          >`SELECT DISTINCT unnest("tags") AS tag FROM "EmailAccount" WHERE "workspaceId" = ${ws} AND "deletedAt" IS NULL`
        : c.query.kind === "campaign"
          ? await prisma.$queryRaw<
              { tag: string }[]
            >`SELECT DISTINCT unnest("tags") AS tag FROM "Campaign" WHERE "workspaceId" = ${ws} AND "deletedAt" IS NULL`
          : await prisma.$queryRaw<
              { tag: string }[]
            >`SELECT DISTINCT unnest("tags") AS tag FROM "Lead" WHERE "workspaceId" = ${ws} AND "deletedAt" IS NULL`;
    return { tags: rows.map((r) => r.tag).sort() };
  },
);
