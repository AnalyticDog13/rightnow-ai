import { pollSession, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { HttpError, route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ workspaceId, params }) => {
  const r = await pollSession(prisma, systemClock, workspaceId, params.id!);
  if (!r) throw new HttpError(404, "Not found");
  return r;
});
