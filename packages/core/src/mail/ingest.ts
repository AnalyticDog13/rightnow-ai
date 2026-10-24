import { createHash } from "node:crypto";
import type {
  EmailAccount,
  MessageKind,
  Prisma,
  PrismaClient,
  ReplyCategory,
} from "@rightnow/db/client";
import type { RemoteMessage } from "@rightnow/providers";
import type { Classification } from "./classify";
import { matchMessage, type Match } from "./match";

type Tx = Prisma.TransactionClient;
export type IngestResult = {
  created: boolean;
  dropped?: true;
  messageId: string;
  threadId: string;
  match: Match;
};

/** "<sha256hex(from|iso date|subject|text[0..512])@rightnow.synthetic>": stable for a message without a Message-ID. */
export function syntheticMessageId(
  m: Pick<RemoteMessage, "from" | "date" | "subject" | "text">,
): string {
  const h = createHash("sha256")
    .update(`${m.from.email}|${m.date.toISOString()}|${m.subject}|${(m.text ?? "").slice(0, 512)}`)
    .digest("hex");
  return `<${h}@rightnow.synthetic>`;
}

const lower = (a: { email: string }) => a.email.toLowerCase();

/** Error code for logs, SyncRun and lastError: a provider/Prisma code or the class name, never a message or body. */
export const codeOf = (e: unknown) => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : e instanceof Error ? e.name : "unknown";
};

const strip = <T>(v: T): T =>
  (typeof v === "string"
    ? v.replaceAll("\u0000", "")
    : Array.isArray(v)
      ? v.map(strip)
      : v && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)]))
        : v) as T;

/** RFC 5322 line limit. */
const LINE = 998;

/** Clips to `n` bytes (fromEmail is indexed); a split trailing character becomes U+FFFD, still within `n`. */
const clipBytes = (s: string, n: number) =>
  Buffer.byteLength(s, "utf8") <= n ? s : Buffer.from(s, "utf8").subarray(0, n).toString("utf8");

/**
 * Makes a provider message storable, so one hostile mail cannot block a mailbox's sync (and its sending) forever:
 * NUL bytes (Postgres refuses them in text) are removed from every string, an invalid date becomes `fallback`, and
 * values that would overflow a btree index entry are dropped (ids over the RFC line limit) or clipped (FR I1).
 */
export function sanitizeRemote(m: RemoteMessage, fallback: Date): RemoteMessage {
  const c = strip(m);
  const fits = (v: string) => Buffer.byteLength(v, "utf8") <= LINE; // btree limits are in bytes
  const id = (v: string | null) => (v && fits(v) ? v : null);
  const addr = (a: RemoteMessage["from"]) => ({
    ...a,
    email: clipBytes(a.email, 320),
    ...(a.name != null && { name: a.name.slice(0, LINE) }),
  });
  return {
    ...c,
    rfcMessageId: id(c.rfcMessageId),
    inReplyTo: id(c.inReplyTo),
    references: c.references.filter(fits),
    from: addr(c.from),
    to: c.to.map(addr),
    cc: c.cc.map(addr),
    subject: c.subject.slice(0, LINE),
    date: Number.isNaN(c.date.getTime()) ? fallback : c.date,
  };
}

/** The thread and lead a provider message belongs to (read-only). */
export function matchFor(
  tx: Tx,
  acct: Pick<EmailAccount, "id" | "workspaceId" | "email">,
  m: RemoteMessage,
): Promise<Match> {
  const out = lower(m.from) === acct.email.toLowerCase();
  return matchMessage(tx, acct.workspaceId, acct.id, {
    inReplyTo: m.inReplyTo,
    references: m.references,
    providerThreadId: m.providerThreadId,
    counterpart: out ? (m.to[0] ? lower(m.to[0]) : "") : lower(m.from),
    subject: m.subject,
    direction: out ? "OUT" : "IN",
    ownId: m.rfcMessageId,
    at: m.date,
  });
}

/** Mail `storeNonLeadMail: false` may discard: inbound replies and auto-replies (never DSNs, ARFs, unsubscribes or our own). */
export const droppable = (acct: Pick<EmailAccount, "email">, m: RemoteMessage, c: Classification) =>
  lower(m.from) !== acct.email.toLowerCase() && (c.kind === "REPLY" || c.kind === "AUTO_REPLY");

/**
 * Stores one provider message and puts it in a thread (matchMessage). A message already stored for the mailbox
 * (a Gmail label re-report, a UIDVALIDITY resync) only gets its providerMessageId/folder updated. The caller runs the
 * stop rules (`applyInbound`) in the same transaction when `created`.
 */
export async function ingestMessage(
  tx: Tx,
  acct: Pick<EmailAccount, "id" | "workspaceId" | "email">,
  m: RemoteMessage,
  c: Classification,
  o: { historical: boolean; dropNonLead?: boolean },
): Promise<IngestResult> {
  const ws = acct.workspaceId;
  const synthetic = !m.rfcMessageId;
  const rfc = m.rfcMessageId ?? syntheticMessageId(m);
  const existing = await tx.message.findUnique({
    where: { accountId_rfcMessageId: { accountId: acct.id, rfcMessageId: rfc } },
    include: { thread: { select: { campaignLeadId: true } } },
  });
  if (existing) {
    await tx.message.update({
      where: { id: existing.id },
      data: {
        providerMessageId: m.providerMessageId || existing.providerMessageId,
        folder: m.folder,
      },
    });
    return {
      created: false,
      messageId: existing.id,
      threadId: existing.threadId,
      match: {
        leadId: existing.leadId,
        campaignId: existing.campaignId,
        campaignLeadId: existing.thread.campaignLeadId,
        scheduledMessageId: existing.scheduledMessageId,
        threadId: existing.threadId,
      },
    };
  }

  const out = lower(m.from) === acct.email.toLowerCase();
  const match = await matchFor(tx, acct, m);
  // PS-CRM-12: the workspace keeps no inbound reply that matches no thread and no lead
  if (o.dropNonLead && droppable(acct, m, c) && !match.threadId && !match.leadId)
    return { created: false, dropped: true, messageId: "", threadId: "", match };
  const own = out
    ? await tx.scheduledMessage.findFirst({
        where: { workspaceId: ws, rfcMessageId: rfc },
        select: { id: true },
      })
    : null;
  const category: ReplyCategory | null =
    c.kind === "REPLY" || c.kind === "AUTO_REPLY"
      ? c.category
      : c.kind === "UNSUBSCRIBE"
        ? "UNSUBSCRIBE"
        : null;
  const kind: MessageKind = c.kind;
  const attached = m.attachments.length > 0;

  let threadId = match.threadId;
  if (!threadId) {
    threadId = (
      await tx.thread.create({
        data: {
          workspaceId: ws,
          accountId: acct.id,
          providerThreadId: m.providerThreadId,
          subject: m.subject,
          leadId: match.leadId,
          campaignId: match.campaignId,
          campaignLeadId: match.campaignLeadId,
          lastMessageAt: m.date,
          isRead: out || o.historical,
        },
        select: { id: true },
      })
    ).id;
  }
  const t = await tx.thread.findUniqueOrThrow({ where: { id: threadId } });
  // an older message (historical import) never rewinds what the newer ones set
  const newer = !t.lastInboundAt || m.date >= t.lastInboundAt;
  await tx.thread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: m.date > t.lastMessageAt ? m.date : undefined,
      leadId: t.leadId ?? match.leadId,
      campaignId: t.campaignId ?? match.campaignId,
      campaignLeadId: t.campaignLeadId ?? match.campaignLeadId,
      ...(attached && { hasAttachment: true }),
      ...(!out && {
        deletedAt: null,
        isRead: o.historical ? undefined : false,
        ...(newer && {
          lastInboundAt: m.date,
          lastInboundKind: kind,
          ...(category &&
            t.categorySource !== "USER" && {
              category,
              categorySource: c.kind === "REPLY" ? c.source : "RULE",
            }),
        }),
      }),
    },
  });

  const msg = await tx.message.create({
    data: {
      workspaceId: ws,
      accountId: acct.id,
      threadId,
      providerMessageId: m.providerMessageId || null,
      rfcMessageId: rfc,
      synthetic,
      inReplyTo: m.inReplyTo,
      references: m.references,
      direction: out ? "OUT" : "IN",
      folder: m.folder,
      fromEmail: lower(m.from),
      fromName: m.from.name ?? null,
      to: m.to.map(lower),
      cc: m.cc.map(lower),
      subject: m.subject,
      text: m.text,
      html: m.html,
      sentAt: m.date,
      kind,
      category,
      ...(c.kind === "BOUNCE" && { bounceType: c.bounceType, bounceRecipient: c.recipient }),
      ...(c.kind === "AUTO_REPLY" && { oooUntil: c.oooUntil }),
      scheduledMessageId: own?.id ?? null,
      outsideApp: out && !own,
      leadId: match.leadId,
      campaignId: match.campaignId,
      attachments: {
        create: m.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
          data: a.content ? new Uint8Array(a.content) : null,
          truncated: !a.content,
        })),
      },
    },
    select: { id: true },
  });
  if (out && !own && match.leadId)
    await tx.lead.updateMany({
      where: {
        id: match.leadId,
        OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: m.date } }],
      },
      data: { lastContactedAt: m.date },
    });
  return { created: true, messageId: msg.id, threadId, match: { ...match, threadId } };
}

/**
 * The Message row for a SENT ScheduledMessage (the sender's accepted result, resolveUncertain's late accept), so a
 * campaign thread shows our own sends without waiting for the Sent-folder sync. Idempotent; errors are logged, never
 * thrown (the send is already recorded).
 */
export async function recordOutboundMessage(
  db: PrismaClient,
  scheduledMessageId: string,
): Promise<void> {
  try {
    const sm = await db.scheduledMessage.findUnique({
      where: { id: scheduledMessageId },
      include: { account: true, campaignLead: { include: { lead: true } } },
    });
    if (!sm || sm.status !== "SENT" || !sm.rfcMessageId || !sm.sentAt) return;
    const prior = await db.scheduledMessage.findMany({
      where: { campaignLeadId: sm.campaignLeadId, status: "SENT", sentAt: { lt: sm.sentAt } },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      select: { rfcMessageId: true },
    });
    const references = prior.flatMap((p) => (p.rfcMessageId ? [p.rfcMessageId] : []));
    const html = sm.renderedBody === sm.renderedText ? null : sm.renderedBody;
    const remote: RemoteMessage = {
      providerMessageId: sm.providerMessageId ?? "",
      ...(sm.providerThreadId ? { providerThreadId: sm.providerThreadId } : {}),
      rfcMessageId: sm.rfcMessageId,
      folder: "SENT",
      inReplyTo: references.at(-1) ?? null,
      references,
      from: { email: sm.account.email, name: sm.account.fromName },
      to: [{ email: sm.campaignLead.lead.email }],
      cc: sm.cc.map((email) => ({ email })),
      subject: sm.renderedSubject,
      date: sm.sentAt,
      text: sm.renderedText,
      html,
      headers: {},
      attachments: [],
    };
    await db.$transaction((tx) =>
      ingestMessage(tx, sm.account, remote, { kind: "OUTBOUND" }, { historical: true }),
    );
  } catch (e) {
    console.error(`recordOutboundMessage: row ${scheduledMessageId} (${codeOf(e)})`);
  }
}
