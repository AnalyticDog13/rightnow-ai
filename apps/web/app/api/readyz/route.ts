import { systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../lib/api";
import { realIpMissing } from "../../../lib/ratelimit";
import { readiness } from "../../../lib/ready";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "public" }, async () => {
  const { ok, body } = await readiness(prisma, systemClock);
  // A9: reported, not failed: rate limits still fail closed, and a 503 would restart a working app
  return Response.json(
    { ok, ...body, ...(realIpMissing && { proxy: "x_real_ip_missing" }) },
    { status: ok ? 200 : 503 },
  );
});
