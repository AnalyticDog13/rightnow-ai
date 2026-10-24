import type { PrismaClient } from "@rightnow/db/client";
import {
  AmbiguousSendError,
  AuthError,
  PermanentSendError,
  RateLimitedError,
  newMessageId,
} from "@rightnow/providers";
import { z } from "zod";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { recordProviderError } from "./health";
import { AccountError, live, providerOf, type Opts } from "./service";
import { domainOf } from "../leads/domain";

const LIMIT = 5;
const WINDOW_MS = 10 * 60_000;

/** Sends one marked message from the account to `to`. Never touches usage rows; the audit row keeps the recipient domain only. */
export async function sendTestEmail(
  prisma: PrismaClient,
  clock: Clock,
  deps: Pick<Opts, "providerFor">,
  p: {
    workspaceId: string;
    actorId?: string | null;
    accountId: string;
    to: string;
    confirmAuthorized: boolean;
    /** A rendered campaign step to send instead of the fixed test text (campaign test-send). */
    content?: { subject: string; html?: string | null; text: string };
  },
): Promise<{ rfcMessageId: string; providerMessageId?: string }> {
  if (!p.confirmAuthorized)
    throw new AccountError(400, "confirm you are authorized to send from this account");
  const to = z.email().safeParse(p.to.trim());
  if (!to.success) throw new AccountError(400, "invalid recipient");
  const a = await live(prisma, p.workspaceId, p.accountId);
  if (!a.credentialsEnc) throw new AccountError(409, "reconnect first");

  const now = clock.now();
  // One transaction per account holding an advisory lock: concurrent requests cannot all read "4 so far".
  // The audit row is written before the send, so an unknown outcome still counts.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"test-send:" + a.id}))`;
    const recent = await tx.auditLog.findMany({
      where: {
        workspaceId: p.workspaceId,
        action: "account.test_send",
        target: a.id,
        createdAt: { gt: new Date(now.getTime() - WINDOW_MS) },
      },
      orderBy: { createdAt: "asc" },
      take: LIMIT,
    });
    if (recent.length >= LIMIT)
      throw new AccountError(429, "rate_limited", {
        retryAfterSec: Math.max(
          1,
          Math.ceil((recent[0]!.createdAt.getTime() + WINDOW_MS - now.getTime()) / 1000),
        ),
      });
    await audit(
      tx,
      { workspaceId: p.workspaceId, actorId: p.actorId, at: now },
      "account.test_send",
      a.id,
      { toDomain: domainOf(to.data) },
    );
  });

  const rfcMessageId = newMessageId(domainOf(a.email));
  const body =
    "This is a test message sent from RightNow to check this account. No reply is needed.";
  try {
    const r = await (await providerOf(prisma, { clock, providerFor: deps.providerFor })(a)).send({
      from: { email: a.email, name: a.fromName },
      to: [{ email: to.data }],
      replyTo: a.replyTo ? { email: a.replyTo } : undefined,
      ...(p.content
        ? { subject: p.content.subject, text: p.content.text, html: p.content.html ?? undefined }
        : {
            subject: "RightNow test email",
            text: a.signature ? `${body}\n\n${a.signature}` : body,
          }),
      messageId: rfcMessageId,
      headers: { "X-RightNow-Test": "1" },
    });
    return { rfcMessageId: r.rfcMessageId, providerMessageId: r.providerMessageId };
  } catch (e) {
    // Only an account-level failure counts against health; a rejected recipient says nothing about the account.
    if (e instanceof AuthError) await recordProviderError(prisma, clock, a.id, e);
    if (e instanceof AuthError) throw new AccountError(409, "needs_attention", { code: e.reason });
    if (e instanceof RateLimitedError)
      throw new AccountError(429, "rate_limited", { retryAfterSec: e.retryAfterSec });
    if (e instanceof AmbiguousSendError)
      throw new AccountError(502, "outcome_unknown", { rfcMessageId });
    if (e instanceof PermanentSendError)
      throw new AccountError(422, "send_rejected", { code: e.code });
    throw new AccountError(502, "provider_unavailable");
  }
}
