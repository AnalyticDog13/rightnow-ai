import { queueVerify, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

const input = z.strictObject({ ids: z.array(z.string().min(1)).min(1).max(1000) });

/** Queues the leads for the lead-verify job; MEMBER and API keys may call it. */
export const POST = route(
  { auth: "session-or-apikey", scope: "leads:update", body: input },
  async (c) =>
    Response.json(await queueVerify(prisma, systemClock, c.workspaceId, c.userId, c.body.ids), {
      status: 202,
    }),
);
