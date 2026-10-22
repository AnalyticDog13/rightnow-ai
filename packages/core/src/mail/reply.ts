import type { PrismaClient } from "@rightnow/db/client";
import {
  AuthError,
  PermanentSendError,
  RateLimitedError,
  TransientBeforeSendError,
  buildMime,
  newMessageId,
  type OutboundMime,
  type SendResult,
} from "@rightnow/providers";
import { convert } from "html-to-text";
import { z } from "zod";
import { recordProviderError } from "../accounts/health";
import { dayKey } from "../accounts/daykey";
import { maxDailyLimit } from "../accounts/factory";
import { AccountError } from "../accounts/service";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { withTxRetry } from "../dispatch";
import { suppressedEmails } from "../leads/suppression";
import { parseEmail } from "../leads/validate";
import { SEND_TIMEOUT_MS } from "../sender";
import type { SyncDeps } from "./sync";

type Db = PrismaClient;
type Actor = string | null | undefined;
type File = { filename: string; contentType: string; content: Buffer };

export const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;
const MS_ATTACHMENTS_BYTES = 3 * 1024 * 1024; // Graph MIME draft limit
const UNCERTAIN =
  "The reply may have been sent. Check the mailbox's Sent folder before trying again.";

export const replyInput = z.strictObject({
  threadId: z.string().min(1),
  mode: z.enum(["reply", "reply_all", "forward"]),
  to: z.array(z.string()).max(50).optional(),
  cc: z.array(z.string()).max(50).optional(),
  html: z.string().min(1).max(1_000_000),
});
export type ReplyInput = z.input<typeof replyInput> & { attachments?: File[] };

const prefixed = (s: string, p: "Re" | "Fwd") =>
  new RegExp(`^\\s*${p === "Re" ? "re" : "fwd?"}:`, "i").test(s) ? s : `${p}: ${s}`;

/** Provider errors as the API reports them. Anything that may have reached the provider is never retried by us. */
async function failure(db: Db, clock: Clock, accountId: string, e: unknown) {
  if (e instanceof AuthError) {
    await recordProviderError(db, clock, accountId, e);
    return new AccountError(409, "account_needs_attention");
  }
  if (e instanceof PermanentSendError) return new AccountError(502, e.code);
  if (e instanceof RateLimitedError) return new AccountError(502, "rate_limited");
  if (e instanceof TransientBeforeSendError) return new AccountError(502, "provider_unavailable");
  return new AccountError(502, "send_uncertain", { message: UNCERTAIN });
}

/**
 * PS-INBOX-02/03: a reply, reply-all or forward from the inbox (D29). Not limited by the user's daily limit, but refused
 * at half the provider cap; it reserves one unit per recipient before the provider call and moves them to today's
 * `sent` on accept, so campaign sends shrink to match. One reply per thread is in flight at a time (409
 * reply_in_progress). The provider call is outside any transaction; an unknown outcome stores nothing and keeps its
 * units reserved (sync imports the mail if it went out).
 */
export async function sendReply(
  prisma: Db,
  clock: Clock,
  deps: { providerFor: SyncDeps["providerFor"] },
  ws: string,
  actor: Actor,
  input: ReplyInput,
): Promise<{ messageId: string }> {
  const { attachments = [], ...rest } = input;
  const r = replyInput.parse(rest);
  const t = await prisma.thread.findFirst({
    where: { id: r.threadId, workspaceId: ws, deletedAt: null },
  });
  const acct =
    t &&
    (await prisma.emailAccount.findFirst({
      where: { id: t.accountId, workspaceId: ws, deletedAt: null },
    }));
  if (!t || !acct) throw new AccountError(404, "Not found");
  if (acct.status !== "CONNECTED") throw new AccountError(409, "account_unavailable");
  const msgs = await prisma.message.findMany({
    where: { threadId: t.id },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
  });
  const last = msgs[0];
  if (!last) throw new AccountError(404, "Not found");
  const lastIn = msgs.find((m) => m.direction === "IN");

  const me = acct.email.toLowerCase();
  const list = (l: string[]) => {
    const ok = l.map((x) => parseEmail(x));
    if (ok.includes(null)) throw new AccountError(400, "invalid_recipient");
    return [...new Set(ok as string[])].filter((x) => x !== me);
  };
  const base = lastIn ?? last;
  const sender = lastIn ? lastIn.fromEmail : (last.to[0] ?? "");
  const to = list(r.to ?? (r.mode === "forward" ? [] : [sender]));
  if (!to.length)
    throw new AccountError(400, r.mode === "forward" ? "to_required" : "no_recipient");
  const cc = list(r.cc ?? (r.mode === "reply_all" ? [...base.to, ...base.cc] : [])).filter(
    (x) => !to.includes(x),
  );
  const everyone = [...to, ...cc];
  if ((await suppressedEmails(prisma, ws, everyone)).size)
    throw new AccountError(409, "recipient_suppressed");

  const now = clock.now();
  const units = everyone.length;
  const day = new Date(`${dayKey(acct.timezone, now)}T00:00:00Z`);

  // sizes first (no `data`): the limits are checked before any attachment bytes are loaded
  const originalMeta =
    r.mode === "forward"
      ? await prisma.attachment.findMany({
          where: { messageId: base.id, data: { not: null } },
          select: { id: true, size: true },
        })
      : [];
  const bytes =
    attachments.reduce((n, f) => n + f.content.length, 0) +
    originalMeta.reduce((n, a) => n + a.size, 0);
  if (bytes > MAX_ATTACHMENTS_BYTES) throw new AccountError(413, "attachments_too_large");
  if (acct.provider === "MICROSOFT" && bytes > MS_ATTACHMENTS_BYTES)
    throw new AccountError(413, "attachments_too_large_for_provider");
  // forward is the one sanctioned read of Attachment.data outside the download route
  const original = originalMeta.length
    ? await prisma.attachment.findMany({ where: { id: { in: originalMeta.map((a) => a.id) } } })
    : [];
  const files: File[] = [
    ...attachments,
    ...original.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: Buffer.from(a.data!),
    })),
  ];

  const threadable = !last.synthetic;
  const refs = threadable ? [...new Set([...last.references, last.rfcMessageId])] : [];
  const mime: OutboundMime = {
    from: { email: acct.email, name: acct.fromName },
    to: to.map((email) => ({ email })),
    cc: cc.map((email) => ({ email })),
    ...(acct.replyTo ? { replyTo: { email: acct.replyTo } } : {}),
    subject: prefixed(t.subject, r.mode === "forward" ? "Fwd" : "Re"),
    html: r.html,
    text: convert(r.html, { wordwrap: false }),
    messageId: newMessageId(me.split("@")[1]!),
    ...(threadable ? { inReplyTo: last.rfcMessageId, references: refs } : {}),
    ...(t.providerThreadId ? { threadId: t.providerThreadId } : {}),
    ...(files.length ? { attachments: files } : {}),
  };
  try {
    await buildMime(mime);
  } catch {
    throw new AccountError(400, "invalid_message");
  }

  // D29: one reply in flight per thread (a lease, as the sync lease: no network call inside a transaction), and the
  // units reserved before the provider call with the claim's guarded upsert: refused past half the provider cap (M3)
  const lease = new Date(now.getTime() + SEND_TIMEOUT_MS + 60_000);
  const cap = maxDailyLimit(acct.providerCap);
  await prisma.$transaction(async (tx) => {
    const got = await tx.thread.updateMany({
      where: { id: t.id, OR: [{ replyLeaseUntil: null }, { replyLeaseUntil: { lt: now } }] },
      data: { replyLeaseUntil: lease },
    });
    if (!got.count) throw new AccountError(409, "reply_in_progress");
    const ok = await tx.$queryRaw<unknown[]>`
      INSERT INTO "AccountDailyUsage" ("accountId", day, sent, reserved)
      SELECT ${acct.id}, ${day}, 0, ${units}::int WHERE ${units}::int <= ${cap}::int
      ON CONFLICT ("accountId", day) DO UPDATE SET reserved = "AccountDailyUsage".reserved + ${units}::int
      WHERE "AccountDailyUsage".sent + "AccountDailyUsage".reserved + ${units}::int <= ${cap}::int
      RETURNING 1`;
    if (!ok.length) throw new AccountError(409, "provider_cap");
  });
  /** reserved -= units, sent += `sent` (0 when nothing went out). */
  const settle = (db: Pick<Db, "$executeRaw">, sent: number) =>
    db.$executeRaw`UPDATE "AccountDailyUsage" SET reserved = GREATEST(reserved - ${units}::int, 0),
      sent = sent + ${sent}::int WHERE "accountId" = ${acct.id} AND day = ${day}`;
  const sendAndStore = async (): Promise<{ messageId: string }> => {
    let res: SendResult;
    try {
      let provider;
      try {
        provider = await deps.providerFor(acct);
      } catch (e) {
        // nothing was sent: an auth failure marks the mailbox, anything else is retryable
        throw e instanceof AuthError ? e : new AccountError(502, "provider_unavailable");
      }
      res = await provider.send(mime, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    } catch (e) {
      const err = e instanceof AccountError ? e : await failure(prisma, clock, acct.id, e);
      // an unknown outcome keeps its units reserved (like UNCERTAIN); anything else did not send
      // (a failed release only holds the units until the day ends: the provider's answer is what the user needs)
      if (err.message !== "send_uncertain") await settle(prisma, 0).catch(() => {});
      throw err;
    }

    const rfc = res.rfcMessageId || mime.messageId;
    const store = () =>
      prisma.$transaction(async (tx) => {
        // M16: the same (accountId, rfcMessageId) upsert as ingestMessage; sync may have imported the mail already
        const have = await tx.message.findUnique({
          where: { accountId_rfcMessageId: { accountId: acct.id, rfcMessageId: rfc } },
          select: { id: true },
        });
        const id =
          have?.id ??
          (
            await tx.message.create({
              data: {
                workspaceId: ws,
                accountId: acct.id,
                threadId: t.id,
                providerMessageId: res.providerMessageId ?? null,
                rfcMessageId: rfc,
                inReplyTo: mime.inReplyTo ?? null,
                references: refs,
                direction: "OUT",
                folder: "SENT",
                fromEmail: me,
                fromName: acct.fromName,
                to,
                cc,
                subject: mime.subject,
                text: mime.text,
                html: r.html,
                sentAt: now,
                kind: "OUTBOUND",
                leadId: t.leadId,
                campaignId: t.campaignId,
                attachments: {
                  create: files.map((f) => ({
                    filename: f.filename,
                    contentType: f.contentType,
                    size: f.content.length,
                    data: new Uint8Array(f.content),
                  })),
                },
              },
              select: { id: true },
            })
          ).id;
        await tx.thread.updateMany({
          where: { id: t.id, lastMessageAt: { lt: now } },
          data: { lastMessageAt: now },
        });
        await tx.thread.update({
          where: { id: t.id },
          data: { isRead: true, ...(files.length && { hasAttachment: true }) },
        });
        await settle(tx, units);
        if (t.leadId)
          await tx.lead.updateMany({
            where: {
              id: t.leadId,
              OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: now } }],
            },
            data: { lastContactedAt: now },
          });
        const action = r.mode === "forward" ? "inbox.forward" : "inbox.reply";
        await audit(tx, { workspaceId: ws, actorId: actor, at: now }, action, t.id, {
          mode: r.mode,
          recipients: units,
          attachments: files.length,
        });
        return id;
      });
    let messageId: string;
    try {
      messageId = await withTxRetry(store);
    } catch (e) {
      try {
        if ((e as { code?: string } | null)?.code !== "P2002") throw e;
        messageId = await withTxRetry(store); // lost the race with sync: the mail is stored now
      } catch (e2) {
        // the provider accepted the mail: say so, never a plain 500 that invites a duplicate
        console.error(
          "sendReply: sent but not stored",
          (e2 as { code?: string } | null)?.code ?? "unknown",
        );
        throw new AccountError(502, "sent_not_recorded", {
          message:
            "The reply was sent but could not be saved here. It will appear after the next mailbox sync - do not send it again.",
        });
      }
    }
    return { messageId };
  };
  try {
    return await sendAndStore();
  } finally {
    await prisma.thread
      .updateMany({ where: { id: t.id, replyLeaseUntil: lease }, data: { replyLeaseUntil: null } })
      .catch(() => {}); // the lease expires on its own
  }
}
