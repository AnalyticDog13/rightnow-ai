import { campaignContentIssues, sendableProviders } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { getWebEnv } from "./env";

/** Launch/resume dependencies. Sendable providers come from ProviderVerification, or all under the Fake (D17). */
export const launchDeps = async () => ({
  appUrl: getWebEnv().APP_URL,
  sendable: await sendableProviders(prisma, getWebEnv()),
  contentIssues: (campaignId: string, ws: string) => campaignContentIssues(prisma, campaignId, ws),
});
