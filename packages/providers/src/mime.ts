import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import type { Addr, Folder, OutboundMime, RemoteMessage } from "./types";

const MAX_ATTACHMENT = 25 * 1024 * 1024;

const fmt = (a: Addr) => (a.name ? { name: a.name, address: a.email } : a.email);

export const newMessageId = (domain: string) => `<${randomUUID()}@${domain}>`;

export async function buildMime(
  m: OutboundMime,
  opts: { keepBcc?: boolean } = {},
): Promise<Buffer> {
  const node = new MailComposer({
    from: fmt(m.from),
    to: m.to.map(fmt),
    cc: m.cc?.map(fmt),
    bcc: m.bcc?.map(fmt),
    replyTo: m.replyTo && fmt(m.replyTo),
    subject: m.subject,
    text: m.text,
    html: m.html,
    messageId: m.messageId,
    date: m.date,
    inReplyTo: m.inReplyTo,
    references: m.references,
    attachments: m.attachments,
    headers: m.headers,
  }).compile();
  node.keepBcc = !!opts.keepBcc;
  return node.build();
}

const addrs = (
  v:
    | { value: { address?: string; name?: string }[] }
    | { value: { address?: string; name?: string }[] }[]
    | undefined,
): Addr[] =>
  [v ?? []]
    .flat()
    .flatMap((g) =>
      g.value.map((a) => ({ email: a.address ?? "", ...(a.name ? { name: a.name } : {}) })),
    );

export async function parseRaw(
  raw: Buffer,
  meta: { providerMessageId: string; providerThreadId?: string; folder: Folder },
): Promise<RemoteMessage> {
  const p = await simpleParser(raw);
  const headers: Record<string, string[]> = {};
  for (const { key, line } of p.headerLines) {
    // unfolded raw value, as sent
    (headers[key.toLowerCase()] ??= []).push(
      line
        .slice(line.indexOf(":") + 1)
        .replace(/\r?\n[ \t]+/g, " ")
        .trim(),
    );
  }
  return {
    providerMessageId: meta.providerMessageId,
    ...(meta.providerThreadId ? { providerThreadId: meta.providerThreadId } : {}),
    rfcMessageId: p.messageId ?? null,
    folder: meta.folder,
    inReplyTo: p.inReplyTo ?? null,
    references: [p.references ?? []].flat(),
    from: addrs(p.from)[0] ?? { email: "" },
    to: addrs(p.to),
    cc: addrs(p.cc),
    subject: p.subject ?? "",
    date: p.date ?? new Date(0),
    text: p.text ?? null,
    html: p.html || null,
    headers,
    attachments: p.attachments.map((a) => ({
      filename: a.filename ?? "",
      contentType: a.contentType,
      size: a.content.length,
      ...(a.content.length > MAX_ATTACHMENT
        ? { content: null, truncated: true }
        : { content: a.content }),
    })),
  };
}
