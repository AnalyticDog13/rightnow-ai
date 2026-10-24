import { getEnv } from "@rightnow/core";
import { HttpError, route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Test harness only (like `_fake/echo`): an OpenAI-compatible model that answers every prompt with fixed text. 404 unless MAIL_PROVIDER_FAKE=1 and not vps. */
export const POST = route({ auth: "public" }, async (c) => {
  const env = getEnv();
  if (!env.MAIL_PROVIDER_FAKE || env.MODE === "vps") throw new HttpError(404, "Not found");
  await c.req.text();
  return {
    choices: [{ message: { content: "Fake AI text" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
});
