import {
  campaignContentIssues,
  dnsGate,
  sendableProviders,
  systemClock,
  unsubscribeKeys,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { resolver } from "./dns";
import { getWebEnv } from "./env";

/**
 * Launch/resume dependencies. Sendable providers come from ProviderVerification, or all under the Fake (D17).
 * Fake mailboxes (dev and e2e) use made-up domains, so the DNS gate is skipped there.
 */
export const launchDeps = async (ws: string) => ({
  appUrl: getWebEnv().APP_URL,
  sendable: await sendableProviders(prisma, getWebEnv()),
  contentIssues: (campaignId: string, w: string) => campaignContentIssues(prisma, campaignId, w),
  dnsGate: getWebEnv().MAIL_PROVIDER_FAKE ? undefined : dnsGate(prisma, resolver, systemClock, ws),
});

/** What the renderer needs to build unsubscribe links (preview and test-send show what the sender would send). */
export const renderEnv = () => ({
  appUrl: getWebEnv().APP_URL,
  unsubscribeKeys: unsubscribeKeys(getWebEnv()),
});
