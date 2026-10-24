import { createHash, randomBytes } from "node:crypto";
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

/**
 * Creates and renews one push subscription per Gmail / Microsoft account. Network calls run outside any
 * transaction; every write is conditional on the row as read, and the unique accountId decides concurrent creates.
 */
export async function renewPush(
  prisma: PrismaClient,
  clock: Clock,
  deps: { providerFor: SyncDeps["providerFor"]; env: PushEnv },
): Promise<{ created: number; renewed: number; failed: number }> {
  const { env } = deps;
  const out = { created: 0, renewed: 0, failed: 0 };
  const providers = (["GMAIL", "MICROSOFT"] as const).filter((p) => pushConfigured(env, p));
  if (!providers.length) return out;
  const now = clock.now();
  const accounts = await prisma.emailAccount.findMany({
    where: {
      provider: { in: providers },
      deletedAt: null,
      status: "CONNECTED",
      credentialsEnc: { not: null },
      OR: [
        { pushSubscription: null },
        { pushSubscription: { expiresAt: { lt: new Date(now.getTime() + RENEW_WITHIN_MS) } } },
      ],
    },
    include: { pushSubscription: true },
    orderBy: { id: "asc" },
    take: BATCH,
  });

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
      // placeholder so the row shows the reason and the next tick retries (expiresAt = now is "due")
      first =
        (
          await prisma.pushSubscription.createMany({
            data: [
              {
                workspaceId: a.workspaceId,
                accountId: a.id,
                provider: a.provider,
                externalId: "",
                expiresAt: now,
                status: "FAILED",
                lastError: code,
              },
            ],
            skipDuplicates: true,
          })
        ).count > 0;
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
    const data = {
      externalId: r.externalId,
      // only the hash is kept; the value was sent once
      clientStateHash: clientState ? createHash("sha256").update(clientState).digest("hex") : null,
      expiresAt: r.expiresAt,
      status: "ACTIVE" as const,
      lastError: null,
    };
    const won = sub
      ? (
          await prisma.pushSubscription.updateMany({
            where: { id: sub.id, externalId: sub.externalId },
            data,
          })
        ).count > 0
      : (
          await prisma.pushSubscription.createMany({
            data: [{ workspaceId: a.workspaceId, accountId: a.id, provider: a.provider, ...data }],
            skipDuplicates: true,
          })
        ).count > 0;
    // A Gmail watch is per mailbox: stopping the loser's would stop the winner's too.
    if (!won && a.provider === "MICROSOFT") await push.unsubscribe(r.externalId).catch(() => {});
    out.created++;
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
          await prisma.pushSubscription.updateMany({
            where: { id: sub.id, externalId: sub.externalId },
            data: { expiresAt: r.expiresAt, status: "ACTIVE", lastError: null },
          });
          out.renewed++;
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
