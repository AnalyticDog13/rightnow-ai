import { AuthError, PermanentSendError, ProviderError } from "../errors";
import { buildMime, parseRaw } from "../mime";
import type {
  Changes,
  CredentialStore,
  Diagnostics,
  Folder,
  Location,
  MailProvider,
  OAuthClient,
  OAuthCreds,
  OutboundMime,
  RemoteMessage,
  SendResult,
  SyncCursor,
} from "../types";
import { GmailHttp, type Clock } from "./http";
import { GOOGLE_SCOPES } from "./oauth";

type GMsg = { id: string; threadId?: string; labelIds?: string[]; raw?: string };
type GHistory = {
  history?: { messagesAdded?: { message: GMsg }[]; messagesDeleted?: { message: GMsg }[] }[];
  nextPageToken?: string;
  historyId?: string;
};
const CONCURRENCY = 8;
const present = (m: RemoteMessage | null): m is RemoteMessage => m !== null;

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

export class GmailProvider implements MailProvider {
  readonly kind = "GMAIL" as const;
  readonly address: string;
  private http: GmailHttp;
  private store: CredentialStore<OAuthCreds>;
  private oauth: OAuthClient;

  constructor(o: {
    address: string;
    store: CredentialStore<OAuthCreds>;
    oauth: OAuthClient;
    fetch?: typeof fetch;
    clock?: Clock;
  }) {
    this.address = o.address.toLowerCase();
    this.store = o.store;
    this.oauth = o.oauth;
    this.http = new GmailHttp(o.store, o.oauth, o);
  }

  async send(m: OutboundMime, opts: { signal?: AbortSignal } = {}): Promise<SendResult> {
    if (m.from.email.toLowerCase() !== this.address) throw new PermanentSendError("from_mismatch");
    const raw = (await buildMime(m, { keepBcc: true })).toString("base64url");
    const r = await this.http.call<GMsg>("messages/send", {
      method: "POST",
      body: { raw, ...(m.threadId ? { threadId: m.threadId } : {}) },
      send: true,
      signal: opts.signal,
    });
    return {
      rfcMessageId: m.messageId,
      providerMessageId: r.id,
      ...(r.threadId ? { providerThreadId: r.threadId } : {}),
    };
  }

  private async search(rfcMessageId: string, scope: "in:sent" | "in:anywhere") {
    const r = await this.http.call<{ messages?: GMsg[] }>("messages", {
      query: { q: `rfc822msgid:${rfcMessageId.replace(/^<|>$/g, "")} ${scope}`, maxResults: 1 },
    });
    return r.messages?.[0]?.id;
  }

  private async fetchRaw(id: string, folder?: Folder): Promise<RemoteMessage | null> {
    const m = await this.http.call<GMsg>(`messages/${id}`, {
      query: { format: "raw" },
      ok404: true,
    });
    if (!m?.raw) return null; // deleted since it was listed
    return parseRaw(Buffer.from(m.raw, "base64url"), {
      providerMessageId: m.id,
      ...(m.threadId ? { providerThreadId: m.threadId } : {}),
      folder: folder ?? (m.labelIds?.includes("SENT") ? "SENT" : "INBOX"),
    });
  }

  async findSent(rfcMessageId: string): Promise<RemoteMessage | null> {
    const id = await this.search(rfcMessageId, "in:sent");
    return id ? this.fetchRaw(id, "SENT") : null;
  }

  async locate(rfcMessageId: string): Promise<Location | null> {
    const id = await this.search(rfcMessageId, "in:anywhere");
    if (!id) return null;
    const m = await this.http.call<GMsg>(`messages/${id}`, {
      query: { format: "minimal" },
      ok404: true,
    });
    if (!m) return null;
    const l = m.labelIds ?? [];
    const folder = l.includes("SPAM")
      ? "SPAM"
      : l.includes("INBOX")
        ? "INBOX"
        : l.includes("SENT")
          ? "SENT"
          : "OTHER";
    return { folder, providerMessageId: id };
  }

  async currentCursor(): Promise<SyncCursor> {
    const r = await this.http.call<{ historyId: string }>("profile");
    return { kind: "gmail", historyId: r.historyId };
  }

  async listChangesSince(cursor: SyncCursor, opts: { limit?: number } = {}): Promise<Changes> {
    if (cursor.kind !== "gmail") throw new ProviderError("not a gmail cursor");
    const h = await this.http.call<GHistory>("history", {
      query: {
        startHistoryId: cursor.historyId,
        historyTypes: ["messageAdded", "messageDeleted"],
        maxResults: opts.limit ?? 200,
        pageToken: cursor.pageToken,
      },
      ok404: true,
    });
    if (!h) return { expired: true };
    const added = new Set<string>();
    const removed = new Set<string>();
    for (const rec of h.history ?? []) {
      for (const { message: g } of rec.messagesAdded ?? []) {
        const l = g.labelIds ?? [];
        // drafts and spam are never reported
        if ((l.includes("INBOX") || l.includes("SENT")) && !l.includes("DRAFT")) added.add(g.id);
      }
      for (const { message: g } of rec.messagesDeleted ?? []) removed.add(g.id);
    }
    const messages = (await mapLimit([...added], CONCURRENCY, (id) => this.fetchRaw(id))).filter(
      present,
    );
    return {
      expired: false,
      messages,
      removed: [...removed],
      // mid-stream: resume inside the same startHistoryId; at the end: the mailbox's current historyId
      cursor: h.nextPageToken
        ? { kind: "gmail", historyId: cursor.historyId, pageToken: h.nextPageToken }
        : { kind: "gmail", historyId: h.historyId ?? cursor.historyId },
      hasMore: !!h.nextPageToken,
    };
  }

  async listMessages(q: { since: Date; folder: Folder; pageToken?: string; limit?: number }) {
    const r = await this.http.call<{ messages?: GMsg[]; nextPageToken?: string }>("messages", {
      query: {
        q: `after:${Math.floor(q.since.getTime() / 1000)}`,
        labelIds: q.folder,
        maxResults: q.limit ?? 100,
        pageToken: q.pageToken,
      },
    });
    const msgs = await mapLimit(r.messages ?? [], CONCURRENCY, (m) =>
      this.fetchRaw(m.id, q.folder),
    );
    return {
      messages: msgs.filter(present),
      ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}),
    };
  }

  async diagnostics(): Promise<Diagnostics> {
    const granted = await this.store.get().then(
      (c) => c.scope.split(" "),
      () => [] as string[],
    );
    const missing = GOOGLE_SCOPES.filter((s) => !granted.includes(s));
    const checks: Diagnostics["checks"] = [{ name: "token", ok: true }];
    const scopes: Diagnostics["checks"][number] = missing.length
      ? {
          name: "scopes",
          ok: false,
          code: "scope_missing",
          message: `missing: ${missing.join(" ")}`,
        }
      : { name: "scopes", ok: true };
    try {
      await this.http.call("profile");
      checks.push(scopes, { name: "api", ok: true });
    } catch (e) {
      if (e instanceof AuthError)
        checks[0] = { name: "token", ok: false, code: e.reason, message: e.message };
      else
        checks.push(scopes, {
          name: "api",
          ok: false,
          code: (e as Error).name,
          message: (e as Error).message,
        });
      if (e instanceof AuthError) checks.push(scopes);
    }
    return { ok: checks.every((c) => c.ok), checks };
  }

  async revoke(): Promise<void> {
    await this.oauth.revoke(await this.store.get());
  }
}
