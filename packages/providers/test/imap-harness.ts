import hoodiecrow from "hoodiecrow-imap";
import { ImapFlow } from "imapflow";
import type { AddressInfo } from "node:net";
import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import { ImapSmtpProvider, buildMime, newMessageId, type MailProvider } from "../src";
import type { FailKind, ProviderHarness, Scenario } from "../src/contract/harness";

export const ADDRESS = "me@rn.test";
const PLUGINS = ["UIDPLUS", "SPECIAL-USE", "LITERALPLUS", "MOVE", "ENABLE", "UNSELECT", "IDLE"];

export type ServerOpts = {
  condstore?: boolean;
  appendToSent?: boolean;
  /** Sent folder name; with specialUse false it carries no \Sent flag (discovery by name). */
  sent?: { name: string; specialUse: boolean };
  smtp?: Partial<SMTPServerOptions>;
  /** Runs once the SMTP server has stored a message (before it answers). */
  onSmtpData?: () => void;
};

/** Mailbox-side scenario steps, shared by the in-process servers and the real GreenMail run. */
export function mailboxScenario(
  admin: <T>(fn: (c: ImapFlow) => Promise<T>) => Promise<T>,
  sentName: string,
): Omit<Scenario, "failNext" | "sentRaw"> {
  const inbound = async (subject: string, text: string, inReplyTo?: string) => {
    const messageId = newMessageId("x.test");
    const raw = await buildMime({
      from: { email: "x@rn.test" },
      to: [{ email: ADDRESS }],
      subject,
      text,
      messageId,
      inReplyTo,
    });
    return { raw, messageId };
  };
  return {
    async receiveInbound(m) {
      const { raw, messageId } = await inbound(m.subject, m.text, m.inReplyTo);
      await admin((c) => c.append("INBOX", raw));
      return { rfcMessageId: messageId };
    },
    async seedInbound(n) {
      await admin(async (c) => {
        for (let i = 0; i < n; i++) {
          const { raw } = await inbound(`seed ${i}`, "t");
          await c.append("INBOX", raw);
        }
      });
    },
    async receiveSpam() {
      const { raw, messageId } = await inbound("spam", "buy");
      await admin((c) => c.append("Junk", raw));
      return { rfcMessageId: messageId };
    },
    async saveDraft() {
      const { raw, messageId } = await inbound("draft", "wip");
      await admin((c) => c.append("Drafts", raw, ["\\Draft"]));
      return { rfcMessageId: messageId };
    },
    async sendExternal(m) {
      const raw = await buildMime({
        from: { email: ADDRESS },
        to: [{ email: "someone@rn.test" }],
        subject: m.subject,
        text: "from my phone",
        messageId: m.messageId,
      });
      await admin((c) => c.append(sentName, raw, ["\\Seen"]));
    },
    async deleteMessage() {
      throw new Error("IMAP does not report deletions");
    },
    async expireCursors() {
      // INBOX cannot be deleted; a recreated Sent gets a higher UIDVALIDITY
      await admin(async (c) => {
        await c.mailboxDelete(sentName);
        await c.mailboxCreate(sentName);
      });
    },
  };
}

/** In-process hoodiecrow IMAP and smtp-server on random loopback ports, CONDSTORE off by default (the worst case). */
export async function startServers(o: ServerOpts = {}) {
  const sent = o.sent ?? { name: "Sent", specialUse: true };
  const folder = (name: string, use?: string) => ({ [name]: use ? { "special-use": use } : {} });
  const imap = hoodiecrow({
    plugins: [...PLUGINS, ...(o.condstore ? ["CONDSTORE"] : [])],
    users: { u: { password: "p" }, admin: { password: "a" } },
    storage: {
      INBOX: {},
      "": {
        separator: "/",
        folders: {
          ...folder(sent.name, sent.specialUse ? "\\Sent" : undefined),
          ...folder("Junk", "\\Junk"),
          ...folder("Drafts", "\\Drafts"),
          ...folder("Trash", "\\Trash"),
        },
      },
    },
  });
  await new Promise<void>((r) => imap.listen(0, "127.0.0.1", r));
  const imapPort = (imap.address() as AddressInfo).port;

  const received: Buffer[] = [];
  let fail: FailKind | undefined;
  let revoked = false;
  const smtpAuth: string[] = [];
  const appendToSent = o.appendToSent ?? true;
  const admin = async <T>(fn: (c: ImapFlow) => Promise<T>) => {
    const c = new ImapFlow({
      host: "127.0.0.1",
      port: imapPort,
      secure: false,
      doSTARTTLS: false,
      auth: { user: "admin", pass: "a" },
      logger: false,
    });
    c.on("error", () => {});
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.logout().catch(() => {});
    }
  };
  const smtp: SMTPServer = new SMTPServer({
    authOptional: false,
    secure: false,
    allowInsecureAuth: true,
    logger: false,
    onAuth(a, _s, cb) {
      smtpAuth.push(a.username ?? "");
      if (revoked || a.username !== "u" || a.password !== "p")
        return cb(new Error("Invalid login"));
      cb(null, { user: "u" });
    },
    onRcptTo(_a, _s, cb) {
      const k = fail;
      if (k === "smtp_4xx" || k === "smtp_5xx" || k === "permanent_rejected") {
        fail = undefined;
        return cb(
          Object.assign(new Error("rejected"), { responseCode: k === "smtp_4xx" ? 450 : 550 }),
        );
      }
      cb();
    },
    onData(stream, _s, cb) {
      const parts: Buffer[] = [];
      stream.on("data", (b: Buffer) => parts.push(b));
      stream.on("end", () => {
        const raw = Buffer.concat(parts);
        received.push(raw);
        const done = async () => {
          if (!appendToSent)
            await admin((c) => c.append(sent.name, raw, ["\\Seen"])).catch(() => {});
          o.onSmtpData?.();
          if (fail === "timeout_after_write") {
            fail = undefined;
            for (const c of smtp.connections)
              (c as unknown as { _socket: { destroy(): void } })._socket.destroy();
            return;
          }
          cb();
        };
        void done();
      });
    },
    ...o.smtp,
  });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  const smtpPort = (smtp.server.address() as AddressInfo).port;

  const creds = (over: { imapPass?: string; smtpPass?: string } = {}) => ({
    imap: {
      host: "127.0.0.1",
      port: imapPort,
      secure: false,
      username: "u",
      password: over.imapPass ?? "p",
    },
    smtp: {
      host: "127.0.0.1",
      port: smtpPort,
      secure: false,
      username: "u",
      password: over.smtpPass ?? "p",
    },
  });
  const provider = (extra: Partial<ConstructorParameters<typeof ImapSmtpProvider>[0]> = {}) =>
    new ImapSmtpProvider({
      address: ADDRESS,
      credentials: async () => creds(),
      appendToSent,
      mode: "local",
      allowPrivate: false,
      ...extra,
    });

  const scenario: Scenario = {
    ...mailboxScenario(admin, sent.name),
    failNext(k) {
      if (k === "auth_revoked") {
        revoked = true;
        imap.users.u!.password = "revoked-elsewhere";
      } else if (k === "connect_refused") smtp.close();
      else fail = k;
    },
    async sentRaw() {
      return [...received];
    },
  };
  const close = async () => {
    await new Promise((r) => smtp.close(() => r(undefined)));
    await new Promise((r) => imap.close(() => r(undefined)));
  };
  return {
    imap,
    smtp,
    imapPort,
    smtpPort,
    creds,
    provider,
    scenario,
    admin,
    close,
    smtpAuth,
    received,
  };
}

export function imapHarness(name: string, o: ServerOpts = {}): ProviderHarness {
  return {
    name,
    supports: new Set([
      "auth_revoked",
      "timeout_after_write",
      "smtp_4xx",
      "connect_refused",
      "smtp_5xx",
      "permanent_rejected",
      "locate",
      "expire",
    ]),
    async setup() {
      const s = await startServers(o);
      return {
        provider: s.provider() as MailProvider,
        scenario: s.scenario,
        reopen: async () => s.provider(),
        close: s.close,
      };
    },
  };
}
