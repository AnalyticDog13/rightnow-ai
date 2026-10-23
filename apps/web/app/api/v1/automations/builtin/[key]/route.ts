import { setBuiltin } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

// ADMIN toggles are session-only: an API key acts as MEMBER.
export const PATCH = route(
  { auth: "session", role: "ADMIN", body: z.strictObject({ enabled: z.boolean() }) },
  (c) => run(() => setBuiltin(prisma, c.workspaceId, c.userId, c.params.key!, c.body.enabled)),
);
