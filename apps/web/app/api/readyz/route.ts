import { systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../lib/api";
import { readiness } from "../../../lib/ready";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "public" }, async () => {
  const { ok, body } = await readiness(prisma, systemClock);
  return Response.json({ ok, ...body }, { status: ok ? 200 : 503 });
});
