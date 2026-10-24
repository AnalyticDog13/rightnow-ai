import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  AccountProvider,
  EmailAccount,
  PrismaClient,
  PushSubscription,
} from "@rightnow/db/client";
import {
  AuthError,
  isPushSource,
  PushError,
  RateLimitedError,
  TransientBeforeSendError,
  type PushSource,
} from "@rightnow/providers";
import { recordProviderError } from "../accounts/health";
import { audit } from "../audit";
import type { Clock } from "../clock";
import type { SyncDeps } from "../mail/sync";

export type PushEnv = {
  MODE: "local" | "vps";
  APP_URL: string;
  GMAIL_PUBSUB_TOPIC?: string;
  GMAIL_PUSH_SA_EMAIL?: string;
  GMAIL_PUSH_AUDIENCE?: string;
};

const RENEW_WITHIN_MS = 24 * 3_600_000;
const BATCH = 200;

/** D48: Gmail push needs vps + topic + service account; Graph push needs vps + an https APP_URL. IMAP never. */
export function pushConfigured(env: PushEnv, provider: AccountProvider): boolean {
  if (env.MODE !== "vps") return false;
  if (provider === "GMAIL") return !!env.GMAIL_PUBSUB_TOPIC && !!env.GMAIL_PUSH_SA_EMAIL;
  if (provider === "MICROSOFT") return env.APP_URL.startsWith("https://");
  return false;
}

/** Error code for lastError and the audit row: a stable code, never a message (messages may echo remote text). */
function codeOf(e: unknown): string {
  if (e instanceof AuthError) return e.reason;
  if (e instanceof RateLimitedError) return "rate_limited";
  if (e instanceof TransientBeforeSendError) return (e.detail ?? "transient").replace(/\s+/g, "_");
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? code : e instanceof Error ? e.name : "error";
}

/** The account is still ours to subscribe: not deleted, connected, with credentials (a disconnect clears all three). */
const LIVE = { deletedAt: null, status: "CONNECTED", credentialsEnc: { not: null } } as const;

type Row = {
  externalId: string | null;
  clientStateHash: string | null;
  expiresAt: Date;
  status: "ACTIVE" | "FAILED";
  lastError: string | null;
};

/** One INSERT that only lands while the account is LIVE: a disconnect between our provider call and this write refuses it. */
async function insertSub(prisma: PrismaClient, a: EmailAccount, d: Row, now: Date) {
  const n = await prisma.$executeRaw`
    INSERT INTO "PushSubscription" ("id", "workspaceId", "accountId", "provider", "externalId", "clientStateHash", "expiresAt", "status", "lastError", "updatedAt")
    SELECT ${randomUUID()}, a."workspaceId", a."id", a."provider", ${d.externalId}::text, ${d.clientStateHash}::text, ${d.expiresAt}::timestamp, ${d.status}::"PushStatus", ${d.lastError}::text, ${now}::timestamp
    FROM "EmailAccount" a
    WHERE a."id" = ${a.id} AND a."deletedAt" IS NULL AND a."status" = 'CONNECTED' AND a."credentialsEnc" IS NOT NULL
    ON CONFLICT ("accountId") DO NOTHING`;
  return n > 0;
}

/**
 * Creates and renews one push subscription per Gmail / Microsoft account. Network calls run outside any
 * transaction; every write is conditional on the row as read and on the account still being live, and the unique
 * accountId decides concurrent creates.
 * shortcut: a disconnect that is mid-transaction (credentials cleared, not yet committed) when the insert runs is not
 * seen; that Graph subscription then lapses on its own in about 7 days, and no row points at it.
 */
export async function renewPush(
  prisma: PrismaClient,
  clock: Clock,
  deps: { providerFor: SyncDeps["providerFor"]; env: PushEnv; batch?: number },
): Promise<{ created: number; renewed: number; failed: number }> {
  const { env } = deps;
  const out = { created: 0, renewed: 0, failed: 0 };
  const providers = (["GMAIL", "MICROSOFT"] as const).filter((p) => pushConfigured(env, p));
  if (!providers.length) return out;
  const now = clock.now();
  const batch = deps.batch ?? BATCH;
  const base = { provider: { in: providers }, ...LIVE };
  // never-tried first, then the least recently attempted: a permanently failing account cannot starve the rest
  const fresh = await prisma.emailAccount.findMany({
    where: { ...base, pushSubscription: null },
    include: { pushSubscription: true },
    orderBy: { id: "asc" },
    take: batch,
  });
  const due =
    fresh.length < batch
      ? await prisma.emailAccount.findMany({
          where: {
            ...base,
            pushSubscription: { expiresAt: { lt: new Date(now.getTime() + RENEW_WITHIN_MS) } },
          },
          include: { pushSubscription: true },
          orderBy: { pushSubscription: { updatedAt: "asc" } },
          take: batch - fresh.length,
        })
      : [];
  const accounts = [...fresh, ...due];

  const fail = async (a: EmailAccount, sub: PushSubscription | null, e: unknown) => {
    const code = codeOf(e);
    out.failed++;
    let first: boolean;
    if (sub) {
      first =
        (
          await prisma.pushSubscription.updateMany({
            where: { id: sub.id, status: "ACTIVE" },
            data: { status: "FAILED", lastError: code },
          })
        ).count > 0;
      if (!first)
        await prisma.pushSubscription.updateMany({
          where: { id: sub.id },
          data: { lastError: code },
        });
    } else {
      // placeholder (externalId null) so the row shows the reason and the next tick retries; expiresAt = now is "due"
      first = await insertSub(
        prisma,
        a,
        {
          externalId: null,
          clientStateHash: null,
          expiresAt: now,
          status: "FAILED",
          lastError: code,
        },
        now,
      );
    }
    if (first) await audit(prisma, { workspaceId: a.workspaceId }, "push.failed", a.id, { code });
    if (e instanceof AuthError) await recordProviderError(prisma, clock, a.id, e);
  };

  const create = async (a: EmailAccount, push: PushSource, sub: PushSubscription | null) => {
    const clientState =
      a.provider === "MICROSOFT" ? randomBytes(32).toString("base64url") : undefined;
    const r = await push.subscribe({
      notificationUrl: `${env.APP_URL.replace(/\/$/, "")}/api/push/${a.provider === "GMAIL" ? "gmail" : "graph"}`,
      ...(clientState ? { clientState } : {}),
      ...(a.provider === "GMAIL" ? { topicName: env.GMAIL_PUBSUB_TOPIC } : {}),
    });
    const row: Row = {
      externalId: r.externalId,
      // only the hash is kept; the value was sent once
      clientStateHash: clientState ? createHash("sha256").update(clientState).digest("hex") : null,
      expiresAt: r.expiresAt,
      status: "ACTIVE",
      lastError: null,
    };
    const won = sub
      ? (
          await prisma.pushSubscription.updateMany({
            where: { id: sub.id, externalId: sub.externalId, account: LIVE },
            data: row,
          })
        ).count > 0
      : await insertSub(prisma, a, row, now);
    if (won) return void out.created++;
    // Refused (the account was disconnected meanwhile) or lost to a concurrent run. A Gmail watch is per mailbox,
    // so only a refusal may stop it: stopping the loser's would stop the winner's.
    const live = (await prisma.emailAccount.count({ where: { id: a.id, ...LIVE } })) > 0;
    if (!live || a.provider === "MICROSOFT") await push.unsubscribe(r.externalId).catch(() => {});
  };

  for (const a of accounts) {
    const sub = a.pushSubscription;
    try {
      const push = await deps.providerFor(a);
      if (!isPushSource(push)) continue;
      if (!sub || !sub.externalId) await create(a, push, sub);
      else {
        try {
          const r = await push.renew(sub.externalId, { topicName: env.GMAIL_PUBSUB_TOPIC });
          const { count } = await prisma.pushSubscription.updateMany({
            where: { id: sub.id, externalId: sub.externalId },
            data: { expiresAt: r.expiresAt, status: "ACTIVE", lastError: null },
          });
          if (count) out.renewed++;
        } catch (e) {
          if (!(e instanceof PushError && e.code === "not_found")) throw e;
          await create(a, push, sub);
        }
      }
    } catch (e) {
      await fail(a, sub, e);
    }
  }
  return out;
}

/** Best effort, before the account's credentials are dropped and outside any transaction. Logs a code only. */
export async function unsubscribePush(prisma: PrismaClient, accountId: string, provider: unknown) {
  if (!isPushSource(provider)) return;
  const sub = await prisma.pushSubscription.findUnique({ where: { accountId } });
  if (!sub?.externalId) return;
  try {
    await provider.unsubscribe(sub.externalId);
  } catch (e) {
    console.warn("push unsubscribe failed", codeOf(e));
  }
}
