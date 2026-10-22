export type ProviderKind = "GMAIL" | "MICROSOFT" | "SMTP";
export type Addr = { email: string; name?: string };
export type Folder = "INBOX" | "SENT";
export type OutboundMime = {
  from: Addr;
  to: Addr[];
  cc?: Addr[];
  bcc?: Addr[];
  replyTo?: Addr;
  subject: string;
  text?: string;
  html?: string;
  messageId: string; // "<local@domain>", ours; every provider must preserve it
  date?: Date;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; contentType: string; content: Buffer }[]; // P4-T06 replies/forwards; transport limits (Graph MIME draft ~4 MB, Gmail raw ~35 MB) are enforced by P4
  headers?: Record<string, string>; // List-Unsubscribe, List-Unsubscribe-Post, X-RightNow-Test
  threadId?: string; // providerThreadId of the thread; Gmail only, ignored elsewhere
};
export type SendResult = {
  rfcMessageId: string;
  providerMessageId?: string;
  providerThreadId?: string;
};
export type RemoteMessage = {
  providerMessageId: string;
  providerThreadId?: string;
  rfcMessageId: string | null;
  folder: Folder;
  inReplyTo: string | null;
  references: string[];
  from: Addr;
  to: Addr[];
  cc: Addr[];
  subject: string;
  date: Date;
  text: string | null;
  html: string | null;
  headers: Record<string, string[]>; // names lowercased
  attachments: {
    filename: string;
    contentType: string;
    size: number;
    content: Buffer | null;
    truncated?: boolean;
  }[]; // content null + truncated above 25 MB
};
export type SyncCursor =
  // `done`: ids already returned from the page the cursor points at, when the ~20 MB cap cut that page short (I-9)
  | { kind: "gmail"; historyId: string; pageToken?: string; done?: string[] } // pageToken = resume inside the same startHistoryId
  | { kind: "graph"; inbox: string; sent: string; done?: string[] } // each is an @odata.deltaLink, or the @odata.nextLink while a page is pending
  | {
      kind: "imap";
      folders: Record<
        Folder,
        { uidValidity: string; lastUid: number; uidNext: number; highestModseq?: string }
      >;
    }
  | { kind: "fake"; epoch: number; seq: number };
/** With hasMore:true, `cursor` resumes strictly after the last message returned: none skipped, none returned twice across calls. Pages are bounded by count (`limit`) and ~20 MB of content. `removed` = providerMessageIds deleted since the cursor (Gmail messageDeleted, Graph @removed; IMAP: always empty, documented unsupported). Drafts and spam are never reported. */
export type Changes =
  | { expired: true }
  | {
      expired: false;
      messages: RemoteMessage[];
      removed: string[];
      cursor: SyncCursor;
      hasMore: boolean;
    };
export type Location = { folder: "INBOX" | "SPAM" | "SENT" | "OTHER"; providerMessageId: string };
export type Diagnostics = {
  ok: boolean;
  checks: {
    name: "token" | "scopes" | "api" | "imap_login" | "smtp_auth" | "sent_folder";
    ok: boolean;
    code?: string;
    command?: string;
    response?: string;
    message?: string;
  }[];
};

export interface MailProvider {
  readonly kind: ProviderKind;
  readonly address: string; // lowercased mailbox; send() rejects any other From
  send(mime: OutboundMime, opts?: { signal?: AbortSignal }): Promise<SendResult>;
  findSent(
    rfcMessageId: string,
    hint?: { providerMessageId?: string },
  ): Promise<RemoteMessage | null>; // hint = Graph fallback lookup by immutable id
  locate(rfcMessageId: string): Promise<Location | null>; // where a message landed (P5 placement, spam rescue); Gmail `in:anywhere`, Graph junkemail, IMAP \Junk
  currentCursor(): Promise<SyncCursor>; // call BEFORE listMessages in a first sync, then listChangesSince
  listChangesSince(cursor: SyncCursor, opts?: { limit?: number }): Promise<Changes>; // INBOX + SENT; default limit 200
  listMessages(q: {
    since: Date;
    folder: Folder;
    pageToken?: string;
    limit?: number;
  }): Promise<{ messages: RemoteMessage[]; nextPageToken?: string }>; // limit default 100
  diagnostics(): Promise<Diagnostics>;
  revoke(): Promise<void>; // Gmail: revoke endpoint; Graph and IMAP: no remote call (Graph has no per-token revocation; revokeSignInSessions would sign the user out everywhere)
}
// Push (Gmail watch, Graph subscriptions, P7-T06) is a separate optional `PushSource` interface and is NOT part of MailProvider.
export interface CredentialStore<C> {
  get(): Promise<C>;
  /** Serialized per account across processes by a DB lease (T02a); the token HTTP call runs outside any DB transaction. "Stale is no longer current" = stored.accessToken !== stale.accessToken. */
  refresh(stale: C, doRefresh: (c: C) => Promise<C>): Promise<C>;
}
export interface OAuthClient {
  authUrl(p: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    loginHint?: string;
  }): string;
  exchange(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ creds: OAuthCreds; email: string; displayName?: string }>;
  refresh(creds: OAuthCreds): Promise<OAuthCreds>; // 15 s timeout; keeps the old refreshToken when the response has none (Google); Microsoft also sends `scope`; error mapping per Errors
  revoke(creds: OAuthCreds): Promise<void>;
}
export type OAuthCreds = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
};
