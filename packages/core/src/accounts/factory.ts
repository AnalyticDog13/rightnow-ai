import type { CapTier, PrismaClient } from "@rightnow/db/client";
import {
  FakeOAuthClient,
  GmailProvider,
  GoogleOAuth,
  GraphProvider,
  ImapSmtpProvider,
  MicrosoftOAuth,
  getFakeProvider,
  type MailProvider,
  type OAuthClient,
  type ProviderKind,
} from "@rightnow/providers";
import { type Clock } from "../clock";
import { getEnv } from "../env";
import { accountCredentialStore, smtpCredentials } from "./credentials";
import { domainOf } from "../leads/domain";

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
  const domain = domainOf(email);
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

/** Every IMAP/SMTP connect, in web and worker, re-checks the host against this (SSRF guard). */
export const hostPolicy = () => {
  const env = getEnv();
  return { mode: env.MODE, allowPrivate: env.ALLOW_PRIVATE_MAIL_HOSTS === "1" };
};

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
  if (provider === "microsoft" && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET)
    return new MicrosoftOAuth({
      clientId: env.MS_CLIENT_ID,
      clientSecret: env.MS_CLIENT_SECRET,
      tenant: env.MS_TENANT,
      fetch: deps.fetch,
    });
  return null;
}

export function createProvider(
  account: {
    id: string;
    provider: "GMAIL" | "MICROSOFT" | "SMTP";
    email: string;
    appendToSent?: boolean;
    workspaceId?: string;
  },
  deps: { prisma: PrismaClient; fetch?: typeof fetch; clock?: Clock },
): MailProvider {
  const kind = account.provider;
  if (getEnv().MAIL_PROVIDER_FAKE) return getFakeProvider(account.email, kind);
  if (kind === "GMAIL") {
    const oauth = getOAuthClient("google", deps);
    if (!oauth) throw new Error("google oauth is not configured");
    return new GmailProvider({
      address: account.email,
      store: accountCredentialStore(deps.prisma, account.id, { clock: deps.clock }),
      oauth,
      fetch: deps.fetch,
      clock: deps.clock,
    });
  }
  if (kind === "MICROSOFT") {
    const oauth = getOAuthClient("microsoft", deps);
    if (!oauth) throw new Error("microsoft oauth is not configured");
    return new GraphProvider({
      address: account.email,
      store: accountCredentialStore(deps.prisma, account.id, { clock: deps.clock }),
      oauth,
      fetch: deps.fetch,
      clock: deps.clock,
    });
  }
  if (!account.workspaceId) throw new Error("an SMTP account needs its workspaceId");
  return new ImapSmtpProvider({
    address: account.email,
    credentials: smtpCredentials(deps.prisma, account.workspaceId, account.id),
    appendToSent: account.appendToSent,
    ...hostPolicy(),
  });
}
