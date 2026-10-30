import { prisma } from "@rightnow/db";
import { route } from "../../../../lib/api";
import { getWebEnv } from "../../../../lib/env";
import { clientIp, limitOrThrow } from "../../../../lib/ratelimit";
import { verifySetupToken, verifyTokenInput } from "../../../../lib/setup";

export const POST = route({ auth: "public", body: verifyTokenInput }, async ({ body, req }) => {
  // same bucket as /api/setup, so the pre-check adds no extra guessing budget (D49)
  await limitOrThrow("setup", `ip:${clientIp(req, getWebEnv().MODE)}`, 10, 900);
  await verifySetupToken(prisma, body.token, getWebEnv().SETUP_TOKEN);
  return { ok: true };
});
