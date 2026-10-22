import { recheckDomain, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";
import { resolver } from "../../../../../../lib/dns";

export const dynamic = "force-dynamic";

/** A fresh check; 404 unless the domain belongs to a live account of this workspace. */
export const POST = route({ auth: "session-or-apikey", scope: "accounts:update" }, (c) =>
  run(() =>
    recheckDomain(prisma, resolver, systemClock, c.workspaceId, c.userId, c.params.domain!),
  ),
);
