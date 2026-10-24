import { smtpConnectInput, testSmtpConnection } from "@rightnow/core";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Runs the same checks as connect without saving anything. */
export const POST = route(
  { auth: "session", role: "ADMIN", body: smtpConnectInput },
  (c) => testSmtpConnection({}, c.body),
);
