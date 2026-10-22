import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AmbiguousSendError,
  AuthError,
  PermanentSendError,
  ProviderError,
  RateLimitedError,
  TransientBeforeSendError,
} from "../errors";
import type { FailKind } from "../contract/harness";
import { buildMime, newMessageId, parseRaw } from "../mime";
import type {
  Addr,
  Changes,
  Diagnostics,
  Folder,
  Location,
  MailProvider,
  OutboundMime,
  ProviderKind,
  RemoteMessage,
  SendResult,
  SyncCursor,
} from "../types";
import {
  fakeMailDir,
  readMailbox,
  updateMailbox,
  type FakeEntry,
  type FakeFolder,
  type FakeMailbox,
} from "./store";

const ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9.-]+$/;

/**
 * File-backed mailbox shared by every process using the same FAKE_MAIL_DIR (D14).
 * `failNext` is per instance (in memory); all other state lives in the JSON file.
 */
export class FakeProvider implements MailProvider {
  readonly kind: ProviderKind;
  readonly address: string;
  private readonly file: string;
  private readonly host?: string;
  private pending: { k: FailKind; retryAfterSec: number }[] = [];
  private pendingReads: FailKind[] = [];
  private revoked = false;

  constructor(address: string, o: { dir?: string; kind?: ProviderKind; host?: string } = {}) {
    this.address = address.toLowerCase();
    if (!ADDRESS.test(this.address) || this.address.includes(".."))
      throw new Error(`invalid fake mailbox address`);
    this.kind = o.kind ?? "GMAIL";
    this.host = o.host;
    this.file = join(o.dir ?? fakeMailDir(), `${this.address}.json`);
  }

  // ---- MailProvider -------------------------------------------------------

  async send(mime: OutboundMime, opts?: { signal?: AbortSignal }): Promise<SendResult> {
    opts?.signal?.throwIfAborted();
    if (mime.from.email.toLowerCase() !== this.address)
      throw new PermanentSendError("from_mismatch");
    const { k: fail, retryAfterSec } = this.takeFailure() ?? {};
    switch (fail) {
      case "rate_limit":
        throw new RateLimitedError(retryAfterSec ?? 7);
      case "auth_revoked":
        throw new AuthError("invalid_grant");
      case "token_5xx":
      case "smtp_4xx":
      case "connect_refused":
        throw new TransientBeforeSendError(fail);
      case "smtp_5xx":
        throw new PermanentSendError(fail);
      case "permanent_rejected":
        throw new PermanentSendError(fail, undefined, { scope: "recipient" });
    }
    const raw = await buildMime(mime);
    const entry = await updateMailbox(this.file, (box) =>
      this.add(
        box,
        "SENT",
        raw,
        mime.messageId,
        mime.threadId ?? this.threadOf(box, mime.inReplyTo),
      ),
    );
    if (fail === "api_5xx" || fail === "timeout_after_write") throw new AmbiguousSendError(fail);
    // restart E2E: the sent copy exists, but the result arrives late (the worker can be killed meanwhile)
    const hang = Number(process.env.FAKE_SEND_HANG_MS ?? 0);
    if (hang > 0) await new Promise((r) => setTimeout(r, hang));
    return {
      rfcMessageId: mime.messageId,
      providerMessageId: entry.id,
      providerThreadId: entry.threadId,
    };
  }

  async findSent(rfcMessageId: string): Promise<RemoteMessage | null> {
    const e = (await readMailbox(this.file)).entries.find(
      (x) => x.folder === "SENT" && x.rfcMessageId === rfcMessageId,
    );
    return e ? this.parse(e) : null;
  }

  async locate(rfcMessageId: string): Promise<Location | null> {
    const e = (await readMailbox(this.file)).entries.findLast(
      (x) => x.rfcMessageId === rfcMessageId,
    );
    if (!e) return null;
    const folder = e.folder === "DRAFT" ? "OTHER" : e.folder;
    return { folder, providerMessageId: e.id };
  }

  async currentCursor(): Promise<SyncCursor> {
    this.readFailure();
    const b = await readMailbox(this.file);
    return { kind: "fake", epoch: b.epoch, seq: b.seq };
  }

  async listChangesSince(cursor: SyncCursor, opts: { limit?: number } = {}): Promise<Changes> {
    if (cursor.kind !== "fake") throw new ProviderError("not a fake cursor");
    this.readFailure();
    const box = await readMailbox(this.file);
    if (cursor.epoch !== box.epoch) return { expired: true };
    const synced = (f: FakeFolder) => f === "INBOX" || f === "SENT";
    const items = [
      ...box.entries
        .filter((e) => e.seq > cursor.seq && synced(e.folder))
        .map((e) => ({ seq: e.seq, e })),
      ...box.removed
        .filter((r) => r.seq > cursor.seq && synced(r.folder))
        .map((r) => ({ seq: r.seq, id: r.id })),
    ].sort((a, b) => a.seq - b.seq);
    const page = items.slice(0, opts.limit ?? 200);
    const hasMore = items.length > page.length;
    const messages = await Promise.all(page.flatMap((i) => ("e" in i ? [this.parse(i.e)] : [])));
    return {
      expired: false,
      messages,
      removed: page.flatMap((i) => ("id" in i ? [i.id] : [])),
      // nothing relevant lies between the last returned item and box.seq when there is no more
      cursor: { kind: "fake", epoch: box.epoch, seq: hasMore ? page.at(-1)!.seq : box.seq },
      hasMore,
    };
  }

  async listMessages(q: { since: Date; folder: Folder; pageToken?: string; limit?: number }) {
    this.readFailure();
    const after = q.pageToken ? Number(q.pageToken) : 0;
    if (!Number.isInteger(after)) throw new PermanentSendError("page_token_invalid");
    const all = (await readMailbox(this.file)).entries.filter(
      (e) => e.folder === q.folder && e.seq > after && new Date(e.date) >= q.since,
    );
    const page = all.slice(0, q.limit ?? 100);
    return {
      messages: await Promise.all(page.map((e) => this.parse(e))),
      ...(all.length > page.length ? { nextPageToken: String(page.at(-1)!.seq) } : {}),
    };
  }

  async diagnostics(): Promise<Diagnostics> {
    if (this.pending[0]?.k === "auth_revoked") this.takeFailure();
    const names =
      this.kind === "SMTP"
        ? (["imap_login", "smtp_auth", "sent_folder"] as const)
        : (["token", "scopes", "api"] as const);
    const checks: Diagnostics["checks"] = names.map((name) => ({ name, ok: true }));
    const bad = (i: number, code: string) =>
      (checks[i] = { name: names[i]!, ok: false, code, message: code });
    if (this.revoked) bad(0, "invalid_grant");
    else if (this.host?.startsWith("fail.")) bad(0, "host_unreachable");
    return { ok: checks.every((c) => c.ok), checks };
  }

  async revoke(): Promise<void> {}

  // ---- controls (tests and the e2e harness) -------------------------------

  /** Drops queued failures and the revoked state (a reconnect with new credentials, P2-T04). */
  clearFailures(): void {
    this.pending = [];
    this.pendingReads = [];
    this.revoked = false;
  }

  /** `retryAfterSec` only matters for rate_limit (default 7). */
  failNext(k: FailKind, retryAfterSec = 7): void {
    this.pending.push({ k, retryAfterSec });
  }

  /** Fails the next read (`currentCursor`, `listChangesSince`, `listMessages`): auth_revoked → AuthError, rate_limit → RateLimitedError, anything else transient. */
  failNextRead(k: FailKind): void {
    this.pendingReads.push(k);
  }

  async receiveInbound(m: {
    from: Addr;
    subject: string;
    text: string;
    inReplyTo?: string;
  }): Promise<{ rfcMessageId: string }> {
    const messageId = newMessageId("fake.test");
    const raw = await buildMime({
      from: m.from,
      to: [{ email: this.address }],
      subject: m.subject,
      text: m.text,
      messageId,
      inReplyTo: m.inReplyTo,
      references: m.inReplyTo ? [m.inReplyTo] : undefined,
    });
    await updateMailbox(
      this.file,
      (box) => void this.add(box, "INBOX", raw, messageId, this.threadOf(box, m.inReplyTo)),
    );
    return { rfcMessageId: messageId };
  }

  /** Delivers a hand-built message (headers, attachments, a missing Message-ID) into INBOX or SENT. */
  async receiveRaw(
    raw: Buffer,
    folder: "INBOX" | "SENT" = "INBOX",
  ): Promise<{ rfcMessageId: string | null }> {
    const p = await parseRaw(raw, { providerMessageId: "", folder });
    await updateMailbox(
      this.file,
      (box) =>
        void this.add(
          box,
          folder,
          raw,
          p.rfcMessageId ?? "",
          this.threadOf(box, p.inReplyTo ?? undefined),
        ),
    );
    return { rfcMessageId: p.rfcMessageId };
  }

  async seedInbound(n: number): Promise<void> {
    const raws = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const messageId = newMessageId("fake.test");
        return {
          messageId,
          raw: await buildMime({
            from: { email: "seed@fake.test" },
            to: [{ email: this.address }],
            subject: `seed ${i}`,
            text: "seed",
            messageId,
          }),
        };
      }),
    );
    await updateMailbox(this.file, (box) =>
      raws.forEach((r) => this.add(box, "INBOX", r.raw, r.messageId)),
    );
  }

  async receiveSpam(): Promise<{ rfcMessageId: string }> {
    const messageId = newMessageId("fake.test");
    const raw = await buildMime({
      from: { email: "spammer@fake.test" },
      to: [{ email: this.address }],
      subject: "spam",
      text: "spam",
      messageId,
    });
    await updateMailbox(this.file, (box) => void this.add(box, "SPAM", raw, messageId));
    return { rfcMessageId: messageId };
  }

  async saveDraft(): Promise<{ rfcMessageId: string }> {
    const messageId = newMessageId("fake.test");
    const raw = await buildMime({
      from: { email: this.address },
      to: [{ email: "draft@fake.test" }],
      subject: "draft",
      text: "draft",
      messageId,
    });
    await updateMailbox(this.file, (box) => void this.add(box, "DRAFT", raw, messageId));
    return { rfcMessageId: messageId };
  }

  /** A message sent from the mailbox by some other client (PS-SYNC-04). */
  async sendExternal(m: { subject: string; messageId: string }): Promise<void> {
    const raw = await buildMime({
      from: { email: this.address },
      to: [{ email: "someone@fake.test" }],
      subject: m.subject,
      text: "external",
      messageId: m.messageId,
    });
    await updateMailbox(this.file, (box) => void this.add(box, "SENT", raw, m.messageId));
  }

  async deleteMessage(id: string): Promise<void> {
    await updateMailbox(this.file, (box) => {
      const i = box.entries.findIndex((e) => e.id === id);
      if (i < 0) return;
      const [e] = box.entries.splice(i, 1);
      box.removed.push({ seq: ++box.seq, id, folder: e!.folder });
    });
  }

  async expireCursors(): Promise<void> {
    await updateMailbox(this.file, (box) => void box.epoch++);
  }

  async sentRaw(): Promise<Buffer[]> {
    return (await readMailbox(this.file)).entries
      .filter((e) => e.folder === "SENT")
      .map((e) => Buffer.from(e.raw, "base64"));
  }

  // ---- internals ----------------------------------------------------------

  private readFailure(): void {
    const k = this.pendingReads.shift();
    if (k === "auth_revoked") throw new AuthError("invalid_grant");
    if (k === "rate_limit") throw new RateLimitedError(7);
    if (k) throw new TransientBeforeSendError(k);
  }

  private takeFailure(): { k: FailKind; retryAfterSec?: number } | undefined {
    if (this.revoked) return { k: "auth_revoked" };
    const f = this.pending.shift();
    if (f?.k === "auth_revoked") this.revoked = true;
    return f;
  }

  private threadOf(box: FakeMailbox, inReplyTo?: string): string | undefined {
    return inReplyTo ? box.entries.find((e) => e.rfcMessageId === inReplyTo)?.threadId : undefined;
  }

  private add(
    box: FakeMailbox,
    folder: FakeFolder,
    raw: Buffer,
    rfcMessageId: string,
    threadId?: string,
  ): FakeEntry {
    const seq = ++box.seq;
    const e: FakeEntry = {
      seq,
      id: `fake-${seq}`,
      folder,
      rfcMessageId,
      threadId: threadId ?? `t-${randomUUID()}`,
      date: new Date().toISOString(),
      raw: raw.toString("base64"),
    };
    box.entries.push(e);
    return e;
  }

  private parse(e: FakeEntry): Promise<RemoteMessage> {
    return parseRaw(Buffer.from(e.raw, "base64"), {
      providerMessageId: e.id,
      providerThreadId: e.threadId,
      folder: e.folder === "SENT" ? "SENT" : "INBOX",
    });
  }
}
