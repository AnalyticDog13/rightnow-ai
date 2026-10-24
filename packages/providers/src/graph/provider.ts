import {
  AmbiguousSendError,
  AuthError,
  PermanentSendError,
  ProviderError,
  PushError,
  TransientBeforeSendError,
} from "../errors";
import { DEFAULT_PAGE_BYTES, listCapped, readCapped } from "../map-limit";
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
  PushSource,
  RemoteMessage,
  SendResult,
  SyncCursor,
} from "../types";
import { assertGraphUrl, GraphHttp, type Clock } from "./http";
import { MS_REQUIRED_SCOPES, normalizeScopes } from "./oauth";

type GMsg = {
  id: string;
  conversationId?: string;
  parentFolderId?: string;
  isDraft?: boolean;
  from?: { emailAddress?: { address?: string } };
  "@removed"?: { reason?: string };
};
type GPage = { value?: GMsg[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
type Cursor = Extract<SyncCursor, { kind: "graph" }>;

const CONCURRENCY = 4; // Graph allows about 4 concurrent requests per mailbox
const WELL_KNOWN = { INBOX: "inbox", SENT: "sentitems" } as const;
const FOLDERS = [
  ["INBOX", "inbox"],
  ["SENT", "sent"],
] as const;
const msgs = `/me/mailFolders`;

export class GraphProvider implements MailProvider, PushSource {
  readonly kind = "MICROSOFT" as const;
  readonly address: string;
  private http: GraphHttp;
  private store: CredentialStore<OAuthCreds>;
  private clock: Clock;
  private sentFolderId?: string;
  private maxPageBytes: number;

  constructor(o: {
    address: string;
    store: CredentialStore<OAuthCreds>;
    oauth: OAuthClient;
    fetch?: typeof fetch;
    clock?: Clock;
    maxPageBytes?: number; // default 20 MB; tests
  }) {
    this.address = o.address.toLowerCase();
    this.maxPageBytes = o.maxPageBytes ?? DEFAULT_PAGE_BYTES;
    this.store = o.store;
    this.clock = o.clock ?? { now: () => new Date() };
    this.http = new GraphHttp(o.store, o.oauth, o);
  }

  /** Draft then send, so the id is known before anything leaves (ImmutableId: it stays the Sent Items id). */
  async send(m: OutboundMime, opts: { signal?: AbortSignal } = {}): Promise<SendResult> {
    if (m.from.email.toLowerCase() !== this.address) throw new PermanentSendError("from_mismatch");
    const mime = (await buildMime(m, { keepBcc: true })).toString("base64");
    const d = await this.http.call<GMsg>("/me/messages", {
      method: "POST",
      text: mime,
      signal: opts.signal,
    });
    if (!d.id) throw new TransientBeforeSendError("draft without id");
    try {
      await this.http.call(`/me/messages/${d.id}/send`, {
        method: "POST",
        send: true,
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof ProviderError) e.providerMessageId = d.id;
      // definitely not sent (rejected, 429, 401, connect refused): do not leave the orphan draft behind.
      // Ambiguous keeps the draft: it may already be in Sent Items, and the caller resolves it by this id.
      if (e instanceof ProviderError && !(e instanceof AmbiguousSendError))
        await this.deleteDraft(d.id).catch(() => {});
      throw e;
    }
    return {
      rfcMessageId: m.messageId,
      providerMessageId: d.id,
      ...(d.conversationId ? { providerThreadId: d.conversationId } : {}),
    };
  }

  /** P3-T11 recovery. With ImmutableId a sent message keeps its draft id, so delete only what is still a draft. */
  async deleteDraft(providerMessageId: string): Promise<void> {
    const id = encodeURIComponent(providerMessageId);
    const m = await this.http.call<GMsg>(`/me/messages/${id}`, {
      query: { $select: "id,isDraft" },
      nullOn: [404],
    });
    if (m?.isDraft === true)
      await this.http.call(`/me/messages/${id}`, { method: "DELETE", nullOn: [404] });
  }

  private async read(id: string, folder: Folder): Promise<RemoteMessage | null> {
    return (await this.readSized(id, folder))?.msg ?? null;
  }

  private async readSized(id: string, folder: Folder) {
    const raw = await this.http.call<Buffer>(`/me/messages/${encodeURIComponent(id)}/$value`, {
      as: "buffer",
      nullOn: [404],
    });
    return raw
      ? { msg: await parseRaw(raw, { providerMessageId: id, folder }), bytes: raw.length }
      : null;
  }

  private byRfcId(path: string, rfcMessageId: string) {
    return this.http.call<GPage>(path, {
      query: {
        $filter: `internetMessageId eq '${rfcMessageId.replaceAll("'", "''")}'`,
        $select: "id,isDraft,from",
        $top: 10,
      },
    });
  }

  /** Searches all folders (review ruling): a user who deleted or junked the Sent copy must not cause a resend. */
  async findSent(
    rfcMessageId: string,
    hint?: { providerMessageId?: string },
  ): Promise<RemoteMessage | null> {
    const sent = (await this.byRfcId(`${msgs}/sentitems/messages`, rfcMessageId)).value ?? [];
    let hit = sent.find((x) => !x.isDraft);
    if (!hit) {
      const all = [
        ...((await this.byRfcId("/me/messages", rfcMessageId)).value ?? []),
        ...((await this.byRfcId(`${msgs}/junkemail/messages`, rfcMessageId)).value ?? []),
      ];
      // ours = From us; a received message reusing the id is not our send, and a draft is not sent yet
      hit = all.find(
        (x) => !x.isDraft && x.from?.emailAddress?.address?.toLowerCase() === this.address,
      );
    }
    if (!hit && hint?.providerMessageId) {
      // Graph may have rewritten the Message-ID: accept the hinted id only if it is in Sent Items
      const m = await this.http.call<GMsg>(
        `/me/messages/${encodeURIComponent(hint.providerMessageId)}`,
        { query: { $select: "id,parentFolderId,isDraft" }, nullOn: [404] },
      );
      this.sentFolderId ??= (
        await this.http.call<{ id: string }>(`${msgs}/sentitems`, { query: { $select: "id" } })
      ).id;
      if (m && !m.isDraft && m.parentFolderId === this.sentFolderId) hit = m;
    }
    return hit ? this.read(hit.id, "SENT") : null;
  }

  async locate(rfcMessageId: string): Promise<Location | null> {
    const places = [
      ["inbox", "INBOX"],
      ["junkemail", "SPAM"],
      ["sentitems", "SENT"],
    ] as const;
    for (const [f, folder] of places) {
      const hit = (await this.byRfcId(`${msgs}/${f}/messages`, rfcMessageId)).value?.find(
        (x) => !x.isDraft,
      );
      if (hit) return { folder, providerMessageId: hit.id };
    }
    const hit = (await this.byRfcId("/me/messages", rfcMessageId)).value?.find((x) => !x.isDraft);
    return hit ? { folder: "OTHER", providerMessageId: hit.id } : null;
  }

  async currentCursor(): Promise<SyncCursor> {
    const since = new Date(this.clock.now().getTime() - 5 * 60_000).toISOString();
    const out: Partial<Cursor> = { kind: "graph" };
    for (const [folder, key] of FOLDERS) {
      let page = await this.http.call<GPage>(`${msgs}/${WELL_KNOWN[folder]}/messages/delta`, {
        query: { $select: "id", $filter: `receivedDateTime ge ${since}` },
      });
      // duplicates of what the window returns are removed by P4 ingest
      while (page["@odata.nextLink"]) page = await this.http.call<GPage>(page["@odata.nextLink"]);
      const link = page["@odata.deltaLink"];
      if (!link) throw new TransientBeforeSendError("delta without deltaLink");
      out[key === "inbox" ? "inbox" : "sent"] = link;
    }
    return out as Cursor;
  }

  async listChangesSince(cursor: SyncCursor, opts: { limit?: number } = {}): Promise<Changes> {
    if (cursor.kind !== "graph") throw new ProviderError("not a graph cursor");
    assertGraphUrl(cursor.inbox);
    assertGraphUrl(cursor.sent);
    let budget = opts.limit ?? 200;
    let hasMore = false;
    const next: Cursor = { kind: "graph", inbox: cursor.inbox, sent: cursor.sent };
    const done = new Set(cursor.done);
    const messages: RemoteMessage[] = [];
    const removed = new Set<string>();
    for (const [folder, key] of FOLDERS) {
      if (budget <= 0) {
        hasMore = true; // this folder has not been looked at yet
        continue;
      }
      const page = await this.http.call<GPage>(cursor[key], {
        pageSize: budget,
        nullOn: [400, 410], // I-7: an invalid or expired delta / skip token
      });
      if (!page) return { expired: true };
      const found: string[] = [];
      for (const g of page.value ?? []) {
        // "deleted", or "changed": moved out of the folder (to Deleted Items, Junk, an archive)
        if (g["@removed"]) removed.add(g.id);
        else if (!done.has(g.id)) found.push(g.id);
      }
      budget -= page.value?.length ?? 0;
      const link = page["@odata.nextLink"] ?? page["@odata.deltaLink"];
      if (!link) throw new TransientBeforeSendError("delta page without a link");
      const r = await readCapped(found, CONCURRENCY, this.maxPageBytes, (id) =>
        this.readSized(id, folder),
      );
      messages.push(...r.messages);
      if (r.consumed.length < found.length) {
        // the byte cap cut this page short: read it again next time, skipping what was returned
        next.done = [...done, ...r.consumed];
        return { expired: false, messages, removed: [...removed], cursor: next, hasMore: true };
      }
      next[key] = link;
      if (page["@odata.nextLink"]) hasMore = true;
    }
    return { expired: false, messages, removed: [...removed], cursor: next, hasMore };
  }

  async listMessages(q: { since: Date; folder: Folder; pageToken?: string; limit?: number }) {
    return listCapped(
      q.pageToken,
      CONCURRENCY,
      this.maxPageBytes,
      async (token) => {
        const r = token
          ? await this.http.call<GPage>(assertGraphUrl(token))
          : await this.http.call<GPage>(`${msgs}/${WELL_KNOWN[q.folder]}/messages`, {
              query: {
                $filter: `receivedDateTime ge ${q.since.toISOString()}`,
                $orderby: "receivedDateTime asc",
                $select: "id",
                $top: q.limit ?? 100,
              },
            });
        return { ids: (r.value ?? []).map((m) => m.id), next: r["@odata.nextLink"] };
      },
      (id) => this.readSized(id, q.folder),
    );
  }

  async diagnostics(): Promise<Diagnostics> {
    let granted: string[];
    try {
      granted = normalizeScopes((await this.store.get()).scope);
    } catch {
      // a DB or decrypt fault is not a scope problem: never ask the user to reconnect for it
      return {
        ok: false,
        checks: [
          {
            name: "token",
            ok: false,
            code: "credentials_unavailable",
            message: "stored credentials could not be read",
          },
        ],
      };
    }
    const missing = MS_REQUIRED_SCOPES.filter((s) => !granted.includes(s));
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
      await this.http.call("/me", { query: { $select: "id" } });
      checks.push(scopes, { name: "api", ok: true });
    } catch (e) {
      if (e instanceof AuthError) {
        checks[0] = { name: "token", ok: false, code: e.reason, message: e.message };
        checks.push(scopes);
      } else
        checks.push(scopes, {
          name: "api",
          ok: false,
          code: (e as Error).name,
          message: (e as Error).message,
        });
    }
    return { ok: checks.every((c) => c.ok), checks };
  }

  /** Inbox "created" subscription (~7 days, Graph's mail maximum is 10 080 min). clientState goes out once; the caller keeps only its hash. */
  async subscribe(o: { notificationUrl: string; clientState?: string }) {
    const r = await this.http.call<{ id: string; expirationDateTime: string }>("/subscriptions", {
      method: "POST",
      json: {
        changeType: "created",
        notificationUrl: o.notificationUrl,
        lifecycleNotificationUrl: o.notificationUrl,
        resource: "me/mailFolders('inbox')/messages",
        expirationDateTime: this.pushExpiry(),
        clientState: o.clientState,
      },
    });
    return { externalId: r.id, expiresAt: new Date(r.expirationDateTime) };
  }

  async renew(externalId: string) {
    const r = await this.http.call<{ expirationDateTime: string }>(
      `/subscriptions/${encodeURIComponent(externalId)}`,
      { method: "PATCH", json: { expirationDateTime: this.pushExpiry() }, nullOn: [404] },
    );
    if (!r) throw new PushError("not_found");
    return { expiresAt: new Date(r.expirationDateTime) };
  }

  async unsubscribe(externalId: string): Promise<void> {
    await this.http.call(`/subscriptions/${encodeURIComponent(externalId)}`, {
      method: "DELETE",
      nullOn: [404],
    });
  }

  private pushExpiry = () => new Date(this.clock.now().getTime() + 10_070 * 60_000).toISOString();

  /** Graph has no per-token revocation (revokeSignInSessions would sign the user out everywhere): no HTTP call. */
  async revoke(): Promise<void> {}
}
