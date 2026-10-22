import { setDomainSelectors, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";
import { resolver } from "../../../../../lib/dns";

export const dynamic = "force-dynamic";

export const PATCH = route(
  {
    auth: "session-or-apikey",
    scope: "accounts:update",
    body: z.strictObject({ selectors: z.array(z.string().regex(/^[a-z0-9._-]{1,63}$/)).max(10) }),
  },
  (c) =>
    run(() =>
      setDomainSelectors(
        prisma,
        resolver,
        systemClock,
        c.workspaceId,
        c.userId,
        c.params.domain!,
        c.body.selectors,
      ),
    ),
);
