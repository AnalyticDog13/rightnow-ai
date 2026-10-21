import { getWebEnv } from "./env";

/** Launch/resume dependencies. D17 stand-in: until T09's sendableProviders() exists only the Fake counts as sendable. */
export const launchDeps = () => ({
  appUrl: getWebEnv().APP_URL,
  sendable: (process.env.MAIL_PROVIDER_FAKE === "1" ? ["GMAIL", "MICROSOFT", "SMTP"] : []) as (
    "GMAIL" | "MICROSOFT" | "SMTP"
  )[],
});
