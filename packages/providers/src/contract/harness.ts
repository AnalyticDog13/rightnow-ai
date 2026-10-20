import type { Addr, MailProvider } from "../types";

export type FailKind =
  | "rate_limit"
  | "auth_revoked"
  | "token_5xx"
  | "api_5xx"
  | "smtp_4xx"
  | "smtp_5xx"
  | "connect_refused"
  | "timeout_after_write"
  | "permanent_rejected";

/** Drives the mailbox behind a provider: the Fake edits its file, real providers talk to fixtures or a test server. */
export type Scenario = {
  receiveInbound(m: {
    from: Addr;
    subject: string;
    text: string;
    inReplyTo?: string;
  }): Promise<{ rfcMessageId: string }>;
  seedInbound(n: number): Promise<void>;
  /** Delivers a message to the spam folder and returns its Message-ID. */
  receiveSpam(): Promise<{ rfcMessageId: string }>;
  saveDraft(): Promise<{ rfcMessageId: string }>;
  sendExternal(m: { subject: string; messageId: string }): Promise<void>;
  deleteMessage(providerMessageId: string): Promise<void>;
  /** The next send (or, for auth_revoked, the next diagnostics) fails this way; rate_limit carries Retry-After 7. */
  failNext(k: FailKind): void;
  /** Must change the UIDVALIDITY/epoch of the SENT folder (INBOX cannot be deleted in IMAP, RFC 3501 6.3.4); any folder's change expires the cursor. */
  expireCursors(): Promise<void>;
  sentRaw(): Promise<Buffer[]>;
};

export type ProviderHarness = {
  name: string;
  supports: Set<FailKind | "removed" | "locate" | "expire">;
  /** Called once per test: a fresh, empty mailbox. */
  setup(): Promise<{
    provider: MailProvider;
    scenario: Scenario;
    /** A fresh provider instance over the same backing mailbox (carries no in-memory state). */
    reopen(): Promise<MailProvider>;
    close(): Promise<void>;
  }>;
};
