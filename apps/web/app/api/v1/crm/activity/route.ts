import { crmActivity } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session-or-apikey", scope: "crm:read" }, (c) =>
  run(() =>
    crmActivity(prisma, c.workspaceId, Object.fromEntries(new URL(c.req.url).searchParams)),
  ),
);
