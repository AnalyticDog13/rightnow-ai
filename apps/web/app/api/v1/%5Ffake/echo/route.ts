import { getEnv } from "@rightnow/core";
import { HttpError, route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

const guard = () => {
  const env = getEnv();
  if (!env.MAIL_PROVIDER_FAKE || env.MODE === "vps") throw new HttpError(404, "Not found");
};

/** Test harness only (like the Fake mailbox): a webhook target that answers 200 to any POST. 404 unless MAIL_PROVIDER_FAKE=1. */
export const POST = route({ auth: "public" }, async (c) => {
  guard();
  await c.req.text();
  return { ok: true };
});
