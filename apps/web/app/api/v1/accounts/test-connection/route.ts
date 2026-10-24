import { smtpConnectInput, testSmtpConnection } from "@rightnow/core";
import { route } from "../../../../../lib/api";
import { limitOrThrow } from "../../../../../lib/ratelimit";

export const dynamic = "force-dynamic";

/** Runs the same checks as connect without saving anything; replies are trimmed (D49). */
export const POST = route({ auth: "session", role: "ADMIN", body: smtpConnectInput }, async (c) => {
  await limitOrThrow("test-connection", `user:${c.userId}`, 10, 60);
  return testSmtpConnection({}, c.body);
});
