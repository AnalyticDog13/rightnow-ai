import { prisma } from "@rightnow/db";
import { route } from "../../../lib/api";
import { getWebEnv } from "../../../lib/env";
import { createFirstOwner, firstOwnerInput } from "../../../lib/setup";

export const POST = route({ auth: "public", body: firstOwnerInput }, async ({ body }) => {
  await createFirstOwner(prisma, body, getWebEnv().SETUP_TOKEN);
  return { ok: true };
});
