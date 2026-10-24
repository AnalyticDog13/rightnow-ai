import { prisma } from "@rightnow/db";
import { route } from "../../../lib/api";
import { getWebEnv } from "../../../lib/env";
import { clientIp, limitOrThrow } from "../../../lib/ratelimit";
import { createFirstOwner, firstOwnerInput } from "../../../lib/setup";

export const POST = route({ auth: "public", body: firstOwnerInput }, async ({ body, req }) => {
  await limitOrThrow("setup", `ip:${clientIp(req, getWebEnv().MODE)}`, 10, 900); // D49: SETUP_TOKEN guessing
  await createFirstOwner(prisma, body, getWebEnv().SETUP_TOKEN);
  return { ok: true };
});
