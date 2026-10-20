import type { CapTier } from "@rightnow/db/client";
import {
  FakeOAuthClient,
  GoogleOAuth,
  type OAuthClient,
  type ProviderKind,
} from "@rightnow/providers";
import { getEnv } from "../env";

/** D7: default provider cap per tier; the max `dailyLimit` is half of it (calendar-day accounting vs rolling windows). */
export const TIER_CAP: Record<CapTier, number> = {
  GMAIL_WORKSPACE: 1500,
  GMAIL_CONSUMER: 400,
  MS365: 5000,
  OUTLOOK_COM: 250,
  SMTP: 100,
};
export const maxDailyLimit = (cap: number) => Math.floor(cap / 2);

export function tierFor(provider: ProviderKind, email: string): CapTier {
  const domain = email.toLowerCase().split("@").pop()!;
  if (provider === "GMAIL")
    return domain === "gmail.com" || domain === "googlemail.com"
      ? "GMAIL_CONSUMER"
      : "GMAIL_WORKSPACE";
  if (provider === "MICROSOFT")
    return ["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)
      ? "OUTLOOK_COM"
      : "MS365";
  return "SMTP";
}

/** null = not configured. MAIL_PROVIDER_FAKE wins over the configured check (the env refuses it in vps mode). */
export function getOAuthClient(
  provider: "google" | "microsoft",
  deps: { fetch?: typeof fetch } = {},
): OAuthClient | null {
  const env = getEnv();
  if (env.MAIL_PROVIDER_FAKE) return new FakeOAuthClient();
  if (provider === "google" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    return new GoogleOAuth({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      fetch: deps.fetch,
    });
  return null; // microsoft arrives in P2-T04
}
