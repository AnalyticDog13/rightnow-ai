import { isIP } from "node:net";
import { Readable } from "node:stream";
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import { PermanentSendError, ProviderError, TransientBeforeSendError } from "../errors";
import { buildMime, parseRaw } from "../mime";
import { assertPublicHost } from "../net";
import type {
  Changes,
  Diagnostics,
  Folder,
  Location,
  MailProvider,
  OutboundMime,
  RemoteMessage,
  SendResult,
  SyncCursor,
} from "../types";
import { pickJunk, pickSent, selectable, type Box } from "./folders";
import { defaultAppendToSent, msSmtpHint } from "./hints";
import { diagnose, HostNotAllowedError, mapImapError, mapSmtpError } from "./map-error";

export type MailServer = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};
export type ImapSmtpCreds = { imap: MailServer; smtp: MailServer };
export type ImapSmtpOptions = {
  address: string;
  /** Read at every operation, so a reconnect with new credentials takes effect without a new instance. */
  credentials: () => Promise<ImapSmtpCreds>;
  /** Default: false for smtp.gmail.com and smtp.office365.com (they save the sent copy), else true. */
  appendToSent?: boolean;
  /** Checked by assertPublicHost before every connection, in every process. */
  mode: "local" | "vps";
  allowPrivate: boolean;
  resolve?: (host: string) => Promise<string[]>; // tests
  logger?: ImapFlowOptions["logger"]; // tests
  maxPageBytes?: number; // default 20 MB; tests
};

type FolderCursor = {
  uidValidity: string;
  lastUid: number;
  uidNext: number;
  highestModseq?: string;
};
type Cursor = Extract<SyncCursor, { kind: "imap" }>;
type Target = { address: string; servername: string; plain: boolean };
type Check = Diagnostics["checks"][number];

const TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000 };
const CHUNK = 20; // messages fetched per command, so a page never sits in memory whole
const DEFAULT_PAGE_BYTES = 20 * 1024 * 1024;
const FOLDERS: Folder[] = ["INBOX", "SENT"];
const EMPTY: FolderCursor = { uidValidity: "0", lastUid: 0, uidNext: 1 };
const tls = (t: Target) => ({
  minVersion: "TLSv1.2" as const,
  ...(isIP(t.servername) ? {} : { servername: t.servername }),
}); // certificate verification stays at the Node default (on): rejectUnauthorized is never set

/** TLS is required before any login: SSL/TLS, or STARTTLS that must succeed. Plain only for a loopback host in local mode. */
export function imapOptions(
  s: MailServer,
  t: Target,
  logger: ImapFlowOptions["logger"] = false,
): ImapFlowOptions {
  return {
    host: t.address,
    port: s.port,
    secure: s.secure,
    doSTARTTLS: s.secure ? undefined : !t.plain,
    tls: tls(t),
    ...(isIP(t.servername) ? {} : { servername: t.servername }),
    auth: { user: s.username, pass: s.password },
    logger,
    disableAutoIdle: true,
    ...TIMEOUTS,
  };
}
export function smtpOptions(s: MailServer, t: Target) {
  return {
    host: t.address,
    port: s.port,
    secure: s.secure,
    requireTLS: !s.secure && !t.plain,
    ignoreTLS: !s.secure && t.plain,
    tls: tls(t),
    ...TIMEOUTS,
  };
}

const pid = (path: string, uv: string, uid: number) => `${encodeURIComponent(path)}:${uv}:${uid}`;
const clip = (s: string | undefined, secrets: string[]) =>
  s === undefined
    ? undefined
    : secrets.reduce((t, x) => (x ? t.split(x).join("***") : t), s).slice(0, 200);

/** Rejection of an SMTP session: the raw error and whether the message body had been handed to the socket. */
class SmtpFailure extends Error {
  constructor(
    readonly error: unknown,
    readonly dataStarted: boolean,
  ) {
    super("smtp session failed");
  }
}

export class ImapSmtpProvider implements MailProvider {
  readonly kind = "SMTP" as const;
  readonly address: string;
  private o: ImapSmtpOptions;

  constructor(o: ImapSmtpOptions) {
    this.o = o;
    this.address = o.address.toLowerCase();
  }

  // ---- connections ----------------------------------------------------------

  private async target(s: MailServer): Promise<Target> {
    try {
      const g = await assertPublicHost(s.host, {
        mode: this.o.mode,
        allowPrivate: this.o.allowPrivate,
        resolve: this.o.resolve,
      });
      return {
        address: g.address,
        servername: g.servername,
        plain: g.loopback && this.o.mode === "local",
      };
    } catch (e) {
      if (e instanceof ProviderError && e.constructor === ProviderError)
        throw new HostNotAllowedError();
      throw e;
    }
  }

  /** Raw errors: diagnostics classify them, everything else maps them. */
  private async openImap(s: MailServer): Promise<ImapFlow> {
    const c = new ImapFlow(imapOptions(s, await this.target(s), this.o.logger));
    c.on("error", () => {}); // a socket error after connect must not crash the process
    try {
      await c.connect();
    } catch (e) {
      c.close();
      throw e;
    }
    return c;
  }

  /** One connection per operation: connect, work, logout. */
  private async withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const creds = await this.o.credentials();
    let c: ImapFlow;
    try {
      c = await this.openImap(creds.imap);
    } catch (e) {
      throw mapImapError(e);
    }
    try {
      return await fn(c);
    } catch (e) {
      throw mapImapError(e);
    } finally {
      await c.logout().catch(() => c.close());
    }
  }

  /** Connects, logs in and, when given a message, sends it. Rejects with SmtpFailure. */
  private async smtpSession(
    s: MailServer,
    msg?: { raw: Buffer; to: string[]; from: string; lead: string[] },
  ): Promise<void> {
    const t = await this.target(s);
    return new Promise<void>((resolve, reject) => {
      const c = new SMTPConnection(smtpOptions(s, t));
      let started = false;
      let settled = false;
      const end = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (err) c.close();
        else c.quit();
        if (err) reject(new SmtpFailure(err, started));
        else resolve();
      };
      c.on("error", end);
      const body = new Readable({
        read() {
          started = true; // the server answered 354: from here a lost reply is ambiguous
          this.push(msg?.raw);
          this.push(null);
        },
      });
      c.connect((e) => {
        if (e) return end(e);
        c.login({ user: s.username, pass: s.password }, (e2) => {
          if (e2) return end(e2);
          if (!msg) return end();
          // gate M-3 (D25): a refused To with an accepted Cc is still a failure for the lead, never a send
          c.send({ from: msg.from, to: msg.to }, body, (e3, info) =>
            end(e3 ?? info?.rejectedErrors?.find((r) => msg.lead.includes(r.recipient ?? ""))),
          );
        });
      });
    });
  }

  // ---- send -----------------------------------------------------------------

  async send(m: OutboundMime, opts: { signal?: AbortSignal } = {}): Promise<SendResult> {
    if (m.from.email.toLowerCase() !== this.address) throw new PermanentSendError("from_mismatch");
    opts.signal?.throwIfAborted();
    const creds = await this.o.credentials();
    const raw = await buildMime(m);
    const to = [...m.to, ...(m.cc ?? []), ...(m.bcc ?? [])].map((a) => a.email);
    try {
      await this.smtpSession(creds.smtp, {
        raw,
        to,
        from: m.from.email,
        lead: m.to.map((a) => a.email),
      });
    } catch (e) {
      throw e instanceof SmtpFailure ? mapSmtpError(e.error, e.dataStarted) : e;
    }
    if (this.o.appendToSent ?? defaultAppendToSent(creds.smtp.host)) {
      try {
        const copy = await buildMime(m, { keepBcc: true });
        await this.withImap(async (c) => {
          const sent = pickSent(await c.list());
          if (!sent) throw new TransientBeforeSendError("no_sent_folder");
          await c.append(sent.path, copy, ["\\Seen"]);
        });
      } catch (e) {
        // The message is out; a missing Sent copy must not turn a delivered send into a failure.
        console.warn(`imap-smtp: could not save the Sent copy (${(e as Error).name})`);
      }
    }
    return { rfcMessageId: m.messageId };
  }

  // ---- lookups --------------------------------------------------------------

  /** Searches every folder by HEADER Message-ID; `first` boxes are tried before the rest. */
  private async search<T>(
    c: ImapFlow,
    first: (Box | undefined)[],
    rfcMessageId: string,
    visit: (box: Box, uid: number, uidValidity: string) => Promise<T | null>,
  ): Promise<T | null> {
    const all = (await c.list()).filter(selectable);
    const head = first.filter((b): b is Box => !!b);
    const boxes = [...head, ...all.filter((b) => !head.some((h) => h.path === b.path))];
    for (const box of boxes) {
      const lock = await c.getMailboxLock(box.path, { readOnly: true });
      try {
        const uids =
          (await c.search({ header: { "message-id": rfcMessageId } }, { uid: true })) || [];
        const uv = String((c.mailbox as { uidValidity: bigint }).uidValidity);
        for (const uid of uids) {
          const r = await visit(box, uid, uv);
          if (r) return r;
        }
      } finally {
        lock.release();
      }
    }
    return null;
  }

  /** Ours, wherever it ended up (Sent, Trash, Junk...): match on Message-ID and our From address. */
  async findSent(rfcMessageId: string): Promise<RemoteMessage | null> {
    return this.withImap(async (c) =>
      this.search(c, [pickSent(await c.list())], rfcMessageId, async (box, uid, uv) => {
        const row = await c.fetchOne(String(uid), { source: true }, { uid: true });
        if (!row || !row.source) return null;
        const folder: Folder = box.path.toUpperCase() === "INBOX" ? "INBOX" : "SENT";
        const m = await parseRaw(row.source, { providerMessageId: pid(box.path, uv, uid), folder });
        return m.rfcMessageId === rfcMessageId && m.from.email.toLowerCase() === this.address
          ? m
          : null;
      }),
    );
  }

  async locate(rfcMessageId: string): Promise<Location | null> {
    return this.withImap(async (c) => {
      const boxes = await c.list();
      const [sent, junk] = [pickSent(boxes), pickJunk(boxes)];
      const inbox = boxes.find((b) => b.path.toUpperCase() === "INBOX");
      return this.search(c, [inbox, junk, sent], rfcMessageId, async (box, uid, uv) => ({
        folder:
          box.path === inbox?.path
            ? ("INBOX" as const)
            : box.path === junk?.path
              ? ("SPAM" as const)
              : box.path === sent?.path
                ? ("SENT" as const)
                : ("OTHER" as const),
        providerMessageId: pid(box.path, uv, uid),
      }));
    });
  }

  // ---- sync -----------------------------------------------------------------

  private async status(c: ImapFlow, path: string) {
    const s = await c.status(path, {
      uidNext: true,
      uidValidity: true,
      ...(c.capabilities.has("CONDSTORE") ? { highestModseq: true } : {}),
    });
    if (!s) throw new TransientBeforeSendError("status_failed");
    return {
      uidValidity: String(s.uidValidity),
      uidNext: s.uidNext ?? 1,
      ...(s.highestModseq !== undefined ? { highestModseq: String(s.highestModseq) } : {}),
    };
  }

  private async paths(c: ImapFlow): Promise<Record<Folder, string | null>> {
    return { INBOX: "INBOX", SENT: pickSent(await c.list())?.path ?? null };
  }

  async currentCursor(): Promise<SyncCursor> {
    return this.withImap(async (c) => {
      const paths = await this.paths(c);
      const folders = {} as Record<Folder, FolderCursor>;
      for (const f of FOLDERS) {
        const s = paths[f] ? await this.status(c, paths[f]!) : undefined;
        folders[f] = s ? { ...s, lastUid: s.uidNext - 1 } : { ...EMPTY };
      }
      return { kind: "imap", folders };
    });
  }

  /** Fetches `uids` (ascending) in small chunks and stops once the page holds ~20 MB. */
  private async read(
    c: ImapFlow,
    path: string,
    uv: string,
    folder: Folder,
    uids: number[],
    since?: Date,
  ) {
    const messages: RemoteMessage[] = [];
    let bytes = 0;
    let consumed = 0;
    let last: number | undefined;
    for (
      let i = 0;
      i < uids.length && bytes < (this.o.maxPageBytes ?? DEFAULT_PAGE_BYTES);
      i += CHUNK
    ) {
      const chunk = uids.slice(i, i + CHUNK);
      const rows = await c.fetchAll(
        chunk.join(","),
        { uid: true, source: true, internalDate: true },
        { uid: true },
      );
      rows.sort((a, b) => a.uid - b.uid);
      for (const r of rows) {
        if (!r.source) continue;
        bytes += r.source.length;
        last = r.uid;
        // SINCE is searched a day early (server-local dates); the exact instant is checked here
        if (since && r.internalDate && new Date(r.internalDate) < since) continue;
        messages.push(
          await parseRaw(r.source, { providerMessageId: pid(path, uv, r.uid), folder }),
        );
      }
      consumed += chunk.length;
    }
    return { messages, last, examined: uids[consumed - 1], drained: consumed >= uids.length };
  }

  async listChangesSince(cursor: SyncCursor, opts: { limit?: number } = {}): Promise<Changes> {
    if (cursor.kind !== "imap") throw new ProviderError("not an imap cursor");
    return this.withImap(async (c) => {
      const paths = await this.paths(c);
      const next = structuredClone((cursor as Cursor).folders);
      const messages: RemoteMessage[] = [];
      let budget = opts.limit ?? 200;
      let hasMore = false;
      for (const f of FOLDERS) {
        const path = paths[f];
        if (!path) continue;
        const cur = next[f];
        const st = await this.status(c, path);
        if (st.uidValidity !== cur.uidValidity) return { expired: true } as const;
        if (st.highestModseq) cur.highestModseq = st.highestModseq;
        if (st.uidNext === cur.uidNext) continue; // nothing arrived (flag changes do not move UIDNEXT)
        if (budget <= 0) {
          hasMore = true;
          continue;
        }
        const lock = await c.getMailboxLock(path, { readOnly: true });
        try {
          const found = (await c.search({ uid: `${cur.lastUid + 1}:*` }, { uid: true })) || [];
          const uids = found.filter((u) => u > cur.lastUid).sort((a, b) => a - b);
          const take = uids.slice(0, budget);
          const page = await this.read(c, path, st.uidValidity, f, take);
          messages.push(...page.messages);
          budget -= page.messages.length;
          // lastUid moves only to the last UID returned, so a page boundary never skips a message
          if (page.last !== undefined) cur.lastUid = page.last;
          if (page.drained && take.length === uids.length) cur.uidNext = st.uidNext;
          else hasMore = true;
        } finally {
          lock.release();
        }
      }
      return {
        expired: false,
        messages,
        removed: [],
        cursor: { kind: "imap", folders: next },
        hasMore,
      } as const;
    });
  }

  async listMessages(q: {
    since: Date;
    folder: Folder;
    pageToken?: string;
    limit?: number;
  }): Promise<{ messages: RemoteMessage[]; nextPageToken?: string }> {
    return this.withImap(async (c) => {
      const path = (await this.paths(c))[q.folder];
      if (!path) return { messages: [] };
      const lock = await c.getMailboxLock(path, { readOnly: true });
      try {
        const uv = String((c.mailbox as { uidValidity: bigint }).uidValidity);
        const [tokenUv, after] = (q.pageToken ?? `${uv}:0`).split(":");
        if (tokenUv !== uv)
          throw new TransientBeforeSendError("mailbox changed, restart the import");
        // SINCE compares calendar dates in the server's zone, so ask for one day earlier and filter by the exact instant.
        const day = new Date(q.since.getTime() - 86_400_000);
        const found =
          (await c.search(q.since.getTime() > 0 ? { since: day } : { all: true }, { uid: true })) ||
          [];
        const uids = found.filter((u) => u > Number(after)).sort((a, b) => a - b);
        const limit = q.limit ?? 100;
        const take = uids.slice(0, limit);
        const page = await this.read(c, path, uv, q.folder, take, q.since);
        // also when the byte cap ended the page early: the token resumes after the last UID examined
        const more = (!page.drained || uids.length > take.length) && page.examined !== undefined;
        return {
          messages: page.messages,
          ...(more ? { nextPageToken: `${uv}:${page.examined}` } : {}),
        };
      } finally {
        lock.release();
      }
    });
  }

  // ---- checks ---------------------------------------------------------------

  private failed(name: Check["name"], e: unknown, s: MailServer): Check {
    const raw = (e instanceof SmtpFailure ? e.error : e) as {
      command?: string;
      response?: string;
      responseText?: string;
    };
    const d = diagnose(raw);
    const response = clip(raw?.response ?? raw?.responseText, [s.password]);
    return {
      name,
      ok: false,
      code: d.code,
      ...(raw?.command ? { command: raw.command } : {}),
      ...(response ? { response } : {}),
      message: (name === "smtp_auth" && msSmtpHint(s.host, response)) || d.message,
    };
  }

  async diagnostics(): Promise<Diagnostics> {
    const { imap, smtp } = await this.o.credentials();
    const imapCheck: Check[] = [];
    let sentCheck: Check = {
      name: "sent_folder",
      ok: false,
      code: "skipped",
      message: "Checked once the IMAP login works.",
    };
    try {
      const c = await this.openImap(imap);
      imapCheck.push({ name: "imap_login", ok: true });
      try {
        sentCheck = pickSent(await c.list())
          ? { name: "sent_folder", ok: true }
          : {
              name: "sent_folder",
              ok: false,
              code: "sent_folder_missing",
              message:
                "No Sent folder was found (looked for the \\Sent flag, Sent, Sent Items, Sent Mail).",
            };
      } catch (e) {
        sentCheck = this.failed("sent_folder", e, imap);
      } finally {
        await c.logout().catch(() => c.close());
      }
    } catch (e) {
      imapCheck.push(this.failed("imap_login", e, imap));
    }
    const smtpCheck: Check = await this.smtpSession(smtp).then(
      () => ({ name: "smtp_auth" as const, ok: true }),
      (e) => this.failed("smtp_auth", e, smtp),
    );
    const checks = [...imapCheck, smtpCheck, sentCheck];
    return { ok: checks.every((x) => x.ok), checks };
  }

  async revoke(): Promise<void> {} // nothing to revoke remotely: the password stays valid at the provider
}
