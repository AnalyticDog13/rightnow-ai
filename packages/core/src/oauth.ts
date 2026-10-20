import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@rightnow/db/client";
import {
  AdminConsentRequiredError,
  GOOGLE_SCOPES,
  getFakeProvider,
  RateLimitedError,
  TransientBeforeSendError,
} from "@rightnow/providers";
import { TIER_MIN_GAP } from "./accounts/caps";
import { setCredentials } from "./accounts/credentials";
import { getOAuthClient, maxDailyLimit, TIER_CAP, tierFor } from "./accounts/factory";
import { audit } from "./audit";
import type { Clock } from "./clock";
import { decrypt, encrypt } from "./crypto";
import { getEnv } from "./env";

const TTL_MS = 10 * 60_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type Provider = "google" | "microsoft";
export type Deps = { fetch?: typeof fetch };
export type OAuthErrorCode =
  | "account_exists"
  | "email_mismatch"
  | "state_invalid"
  | "expired"
  | "access_denied"
  | "scope_missing"
  | "no_refresh_token"
  | "exchange_failed"
  | "admin_consent_required"
  | "provider_unavailable" // Google 5xx / network / rate limit: retry later
  | "server_error";

/** Thrown by startOAuth only; the route maps not_configured to 412 and account_not_found to 404. */
export class OAuthStartError extends Error {
  constructor(readonly code: "not_configured" | "account_not_found") {
    super(code);
  }
}
class Fail extends Error {
  constructor(readonly code: OAuthErrorCode) {
    super(code);
  }
}

/** RFC 7636 S256. */
export function pkce(verifier = randomBytes(32).toString("base64url")) {
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

// Fixed from APP_URL, never from the request: no open redirect.
const redirectUri = (provider: Provider) =>
  new URL(`/api/v1/oauth/${provider}/callback`, getEnv().APP_URL).toString();

export async function startOAuth(
  prisma: PrismaClient,
  clock: Clock,
  deps: Deps,
  p: {
    workspaceId: string;
    userId: string;
    provider: Provider;
    reconnectAccountId?: string;
    loginHint?: string;
  },
): Promise<{ sessionId: string; authUrl: string; expiresAt: Date }> {
  const client = getOAuthClient(p.provider, deps);
  if (!client) throw new OAuthStartError("not_configured");
  let loginHint = p.loginHint;
  if (p.reconnectAccountId) {
    const a = await prisma.emailAccount.findFirst({
      where: { id: p.reconnectAccountId, workspaceId: p.workspaceId, deletedAt: null },
      select: { email: true, provider: true },
    });
    // A different provider's account (SMTP, Microsoft) must not receive these tokens.
    if (!a || a.provider !== (p.provider === "google" ? "GMAIL" : "MICROSOFT"))
      throw new OAuthStartError("account_not_found");
    loginHint ??= a.email;
  }
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = pkce();
  const s = await prisma.oAuthSession.create({
    data: {
      workspaceId: p.workspaceId,
      createdByUserId: p.userId,
      provider: p.provider === "google" ? "GMAIL" : "MICROSOFT",
      stateHash: sha256(state), // the state itself is never stored
      codeVerifierEnc: encrypt(verifier),
      reconnectAccountId: p.reconnectAccountId,
      expiresAt: new Date(clock.now().getTime() + TTL_MS),
    },
  });
  const authUrl = client.authUrl({
    state,
    codeChallenge: challenge,
    redirectUri: redirectUri(p.provider),
    loginHint,
  });
  return { sessionId: s.id, authUrl, expiresAt: s.expiresAt };
}

/** Scopes each provider must have granted; Microsoft echoes some as full URLs, which are normalized first. */
export function missingScopes(provider: Provider, scope: string): string[] {
  const granted = scope
    .split(" ")
    .map((x) => (provider === "microsoft" ? x.replace("https://graph.microsoft.com/", "") : x));
  const required = provider === "google" ? GOOGLE_SCOPES : ["Mail.Send", "Mail.ReadWrite"];
  return required.filter((r) => !granted.includes(r));
}

const isOutage = (e: unknown) =>
  e instanceof TransientBeforeSendError || e instanceof RateLimitedError;
const isUniqueViolation = (e: unknown) => /P2002|23505/.test(JSON.stringify(e) + String(e));

/** Callback. User-level failures are recorded on the session and returned, never thrown. */
export async function completeOAuth(
  prisma: PrismaClient,
  clock: Clock,
  deps: Deps,
  p: {
    workspaceId: string;
    userId: string;
    state?: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  },
): Promise<{ sessionId: string; accountId?: string; errorCode?: OAuthErrorCode }> {
  if (!p.state) return { sessionId: "", errorCode: "state_invalid" };
  const now = clock.now();
  const hash = sha256(p.state);
  // Atomic single-use claim; only the session's own user and workspace can consume it.
  const [s] = await prisma.$queryRaw<
    {
      id: string;
      provider: "GMAIL" | "MICROSOFT";
      reconnectAccountId: string | null;
      codeVerifierEnc: string;
    }[]
  >`UPDATE "OAuthSession" SET "consumedAt" = ${now}
    WHERE "stateHash" = ${hash} AND "workspaceId" = ${p.workspaceId} AND "createdByUserId" = ${p.userId}
      AND "consumedAt" IS NULL AND "status" = 'PENDING' AND "expiresAt" > ${now}
    RETURNING "id", "provider", "reconnectAccountId", "codeVerifierEnc"`;
  if (!s) {
    const late = await prisma.oAuthSession.updateMany({
      where: {
        stateHash: hash,
        workspaceId: p.workspaceId,
        createdByUserId: p.userId,
        consumedAt: null,
        status: "PENDING",
        expiresAt: { lte: now },
      },
      data: { status: "EXPIRED", errorCode: "expired", consumedAt: now },
    });
    return { sessionId: "", errorCode: late.count ? "expired" : "state_invalid" };
  }
  const fail = async (code: OAuthErrorCode) => {
    await prisma.oAuthSession.update({
      where: { id: s.id },
      data: { status: "ERROR", errorCode: code },
    });
    return { sessionId: s.id, errorCode: code };
  };
  try {
    if (p.error) {
      // Entra reports "needs admin approval" as an error with an AADSTS code in the description (never stored)
      if (/AADSTS(65001|90094)/.test(p.errorDescription ?? ""))
        return await fail("admin_consent_required");
      return await fail(p.error === "access_denied" ? "access_denied" : "server_error");
    }
    if (!p.code) return await fail("exchange_failed");
    const provider: Provider = s.provider === "GMAIL" ? "google" : "microsoft";
    const client = getOAuthClient(provider, deps);
    if (!client) return await fail("server_error");
    const x = await client
      .exchange({
        code: p.code,
        codeVerifier: decrypt(s.codeVerifierEnc),
        redirectUri: redirectUri(provider),
      })
      .catch((e: unknown) =>
        e instanceof AdminConsentRequiredError ? "consent" : isOutage(e) ? "outage" : null,
      ); // errors can hold response text; the session records only a code
    if (x === "consent") return await fail("admin_consent_required");
    if (x === "outage") return await fail("provider_unavailable");
    if (!x) return await fail("exchange_failed");
    if (!x.creds.refreshToken) return await fail("no_refresh_token");
    if (!getEnv().MAIL_PROVIDER_FAKE) {
      if (missingScopes(provider, x.creds.scope).length) return await fail("scope_missing");
    }
    const email = x.email.toLowerCase();
    const creds = { kind: "oauth", ...x.creds } as const;
    const accountId = await prisma
      .$transaction(async (tx) => {
        const base = { status: "CONNECTED", lastError: Prisma.DbNull, errorCount24h: 0 } as const;
        let id: string;
        let action = "account.connect";
        if (s.reconnectAccountId) {
          action = "account.reconnect";
          const a = await tx.emailAccount.findFirst({
            where: { id: s.reconnectAccountId, workspaceId: p.workspaceId, deletedAt: null },
          });
          if (!a) throw new Fail("server_error"); // deleted since start: never report success
          if (a.provider !== s.provider) throw new Fail("server_error"); // changed since start
          if (a.email !== email) throw new Fail("email_mismatch");
          id = a.id;
          const resume =
            a.lifecycle === "NEEDS_ATTENTION" ||
            (a.lifecycle === "PAUSED" && a.status === "DISCONNECTED");
          const data = { ...base, ...(resume && { lifecycle: "ACTIVE" as const }) };
          if (!(await setCredentials(tx, p.workspaceId, id, creds, data)))
            throw new Fail("server_error");
        } else {
          const live = { workspaceId: p.workspaceId, email, deletedAt: null };
          if (await tx.emailAccount.findFirst({ where: live })) throw new Fail("account_exists");
          const capTier = tierFor(s.provider, email);
          const providerCap = TIER_CAP[capTier];
          const dead = await tx.emailAccount.findFirst({
            where: { workspaceId: p.workspaceId, email, deletedAt: { not: null } },
            orderBy: { createdAt: "desc" },
          });
          const name = x.displayName ?? email.split("@")[0]!;
          // Credentials are written only through setCredentials, once the row is live.
          if (dead) {
            // Conditional on still being deleted: a concurrent connect that revived it first wins.
            const won = await tx.emailAccount.updateMany({
              where: { id: dead.id, workspaceId: p.workspaceId, deletedAt: { not: null } },
              data: {
                provider: s.provider,
                capTier,
                providerCap,
                dailyLimit: Math.min(dead.dailyLimit, maxDailyLimit(providerCap)),
                minGapSec: Math.max(dead.minGapSec, TIER_MIN_GAP[capTier]),
                deletedAt: null,
                lifecycle: "ACTIVE",
              },
            });
            if (!won.count) throw new Fail("account_exists");
          }
          const row = dead
            ? dead
            : await tx.emailAccount.create({
                data: {
                  workspaceId: p.workspaceId,
                  provider: s.provider,
                  email,
                  fromName: name,
                  firstName: name,
                  lastName: "",
                  capTier,
                  providerCap,
                  dailyLimit: Math.min(30, maxDailyLimit(providerCap)),
                  minGapSec: TIER_MIN_GAP[capTier],
                },
              });
          id = row.id;
          if (!(await setCredentials(tx, p.workspaceId, id, creds, base)))
            throw new Fail("server_error");
        }
        await audit(tx, { workspaceId: p.workspaceId, actorId: p.userId }, action, id, {
          provider: s.provider,
          email,
        });
        await tx.oAuthSession.update({
          where: { id: s.id },
          data: { status: "SUCCESS", accountId: id },
        });
        return id;
      })
      .catch((e: unknown) => {
        if (!(e instanceof Fail) && isUniqueViolation(e)) throw new Fail("account_exists");
        throw e;
      });
    // A reconnect is a fresh grant: the Fake forgets its queued failures and revoked state.
    if (s.reconnectAccountId && getEnv().MAIL_PROVIDER_FAKE)
      getFakeProvider(email, s.provider).clearFailures();
    return { sessionId: s.id, accountId };
  } catch (e) {
    if (!(e instanceof Fail)) console.error("oauth callback failed", (e as Error).name);
    return await fail(e instanceof Fail ? e.code : "server_error");
  }
}

/** Terminal results are readable once; null = unknown, other workspace, or already read. */
export async function pollSession(
  prisma: PrismaClient,
  clock: Clock,
  workspaceId: string,
  sessionId: string,
): Promise<{
  status: "pending" | "success" | "error" | "expired";
  accountId?: string;
  errorCode?: OAuthErrorCode;
} | null> {
  const s = await prisma.oAuthSession.findFirst({ where: { id: sessionId, workspaceId } });
  if (!s) return null;
  const lapsed = s.status === "PENDING" && s.expiresAt <= clock.now();
  if (s.status === "PENDING" && !lapsed) return { status: "pending" };
  const gone = await prisma.oAuthSession.deleteMany({ where: { id: s.id, workspaceId } });
  if (!gone.count) return null;
  return {
    status: lapsed ? "expired" : (s.status.toLowerCase() as "success" | "error" | "expired"),
    ...(s.accountId && { accountId: s.accountId }),
    ...((s.errorCode || lapsed) && { errorCode: (s.errorCode ?? "expired") as OAuthErrorCode }),
  };
}

/**
 * Cancel (UI Cancel button): a still-pending session of this user stops accepting a callback. Returns false
 * when there was nothing to cancel (unknown, other user or workspace, already consumed or finished).
 */
export async function cancelSession(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const r = await prisma.oAuthSession.deleteMany({
    where: {
      id: sessionId,
      workspaceId,
      createdByUserId: userId,
      status: "PENDING",
      consumedAt: null,
    },
  });
  return r.count === 1;
}
