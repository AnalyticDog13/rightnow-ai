import {
  AmbiguousSendError,
  AuthError,
  PermanentSendError,
  ProviderError,
  TransientBeforeSendError,
} from "../errors";
import { mapLimit } from "../map-limit";
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
const present = (m: RemoteMessage | null): m is RemoteMessage => m !== null;
const msgs = `/me/mailFolders`;

export class GraphProvider implements MailProvider {
  readonly kind = "MICROSOFT" as const;
  readonly address: string;
  private http: GraphHttp;
  private store: CredentialStore<OAuthCreds>;
  private clock: Clock;
  private sentFolderId?: string;

  constructor(o: {
    address: string;
    store: CredentialStore<OAuthCreds>;
    oauth: OAuthClient;
    fetch?: typeof fetch;
    clock?: Clock;
  }) {
    this.address = o.address.toLowerCase();
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
    const raw = await this.http.call<Buffer>(`/me/messages/${encodeURIComponent(id)}/$value`, {
      as: "buffer",
      nullOn: [404],
    });
    return raw ? parseRaw(raw, { providerMessageId: id, folder }) : null;
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
    const next: Cursor = { ...cursor };
    const found: { id: string; folder: Folder }[] = [];
    const removed = new Set<string>();
    for (const [folder, key] of FOLDERS) {
      if (budget <= 0) {
        hasMore = true; // this folder has not been looked at yet
        continue;
      }
      const page = await this.http.call<GPage>(cursor[key], {
        pageSize: budget,
        nullOn: [410],
      });
      if (!page) return { expired: true };
      for (const g of page.value ?? []) {
        // moved out of the folder ("changed") is not a deletion: the message lives on elsewhere
        const rm = g["@removed"];
        if (!rm) found.push({ id: g.id, folder });
        else if (rm.reason === "deleted") removed.add(g.id);
      }
      budget -= page.value?.length ?? 0;
      const link = page["@odata.nextLink"] ?? page["@odata.deltaLink"];
      if (!link) throw new TransientBeforeSendError("delta page without a link");
      next[key] = link;
      if (page["@odata.nextLink"]) hasMore = true;
    }
    const messages = (await mapLimit(found, CONCURRENCY, (f) => this.read(f.id, f.folder))).filter(
      present,
    );
    return { expired: false, messages, removed: [...removed], cursor: next, hasMore };
  }

  async listMessages(q: { since: Date; folder: Folder; pageToken?: string; limit?: number }) {
    const r = q.pageToken
      ? await this.http.call<GPage>(assertGraphUrl(q.pageToken))
      : await this.http.call<GPage>(`${msgs}/${WELL_KNOWN[q.folder]}/messages`, {
          query: {
            $filter: `receivedDateTime ge ${q.since.toISOString()}`,
            $orderby: "receivedDateTime asc",
            $select: "id",
            $top: q.limit ?? 100,
          },
        });
    const out = await mapLimit(r.value ?? [], CONCURRENCY, (m) => this.read(m.id, q.folder));
    return {
      messages: out.filter(present),
      ...(r["@odata.nextLink"] ? { nextPageToken: r["@odata.nextLink"] } : {}),
    };
  }

  async diagnostics(): Promise<Diagnostics> {
    const granted = await this.store.get().then(
      (c) => normalizeScopes(c.scope),
      () => [] as string[],
    );
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

  /** Graph has no per-token revocation (revokeSignInSessions would sign the user out everywhere): no HTTP call. */
  async revoke(): Promise<void> {}
}
