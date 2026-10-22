import { createProvider, getEnv, syncDue, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { HttpError, route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Test harness only (M14): runs one mail sync now, so e2e does not wait for the worker's poll. 404 unless MAIL_PROVIDER_FAKE=1. */
export const POST = route({ role: "ADMIN" }, async () => {
  const env = getEnv();
  if (!env.MAIL_PROVIDER_FAKE || env.MODE === "vps") throw new HttpError(404, "Not found");
  await prisma.emailAccount.updateMany({ data: { lastSyncAttemptAt: null } }); // make every account due again
  return syncDue(prisma, systemClock, {
    providerFor: async (a) => createProvider(a, { prisma, clock: systemClock }),
    env,
  });
});
