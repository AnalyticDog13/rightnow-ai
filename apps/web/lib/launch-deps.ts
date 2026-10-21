import { campaignContentIssues, sendableProviders, unsubscribeKeys } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { getWebEnv } from "./env";

/** Launch/resume dependencies. Sendable providers come from ProviderVerification, or all under the Fake (D17). */
export const launchDeps = async () => ({
  appUrl: getWebEnv().APP_URL,
  sendable: await sendableProviders(prisma, getWebEnv()),
  contentIssues: (campaignId: string, ws: string) => campaignContentIssues(prisma, campaignId, ws),
});

/** What the renderer needs to build unsubscribe links (preview and test-send show what the sender would send). */
export const renderEnv = () => ({
  appUrl: getWebEnv().APP_URL,
  unsubscribeKeys: unsubscribeKeys(getWebEnv()),
});
