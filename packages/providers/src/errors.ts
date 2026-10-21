/** Error objects never carry response bodies (they contain tokens): build messages from status/codes only. */
export class ProviderError extends Error {
  declare cause?: unknown;
  /** Set by a provider that created a remote draft before failing (Graph send), so recovery can find or delete it. */
  providerMessageId?: string;
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = new.target.name;
  }
}

export class RateLimitedError extends ProviderError {
  constructor(
    readonly retryAfterSec: number,
    opts?: { cause?: unknown },
  ) {
    super(`rate limited, retry after ${retryAfterSec}s`, opts);
  }
}

export class AuthError extends ProviderError {
  constructor(
    readonly reason: "invalid_grant" | "unauthorized" | "scope_revoked" | "bad_credentials",
    opts?: { cause?: unknown },
  ) {
    super(`auth failed: ${reason}`, opts);
  }
}

/** D18: who the rejection is about. Only `recipient` may suppress a lead; `account` pauses the mailbox. */
export type PermanentScope = "recipient" | "account" | "unknown";

export class PermanentSendError extends ProviderError {
  readonly scope: PermanentScope;
  /** false for a rejection known to say nothing about the mailbox (M365 5.4.1): no strike toward the unknown-scope pause. */
  readonly countsTowardPause: boolean;
  constructor(
    readonly code: string,
    readonly detail?: string,
    opts?: { cause?: unknown; scope?: PermanentScope; countsTowardPause?: boolean },
  ) {
    super(`permanent send error: ${code}${detail ? ` (${detail})` : ""}`, opts);
    // every provider refuses a foreign From with this code: always the account's problem
    this.scope = opts?.scope ?? (code === "from_mismatch" ? "account" : "unknown");
    this.countsTowardPause = opts?.countsTowardPause ?? true;
  }
}

export class TransientBeforeSendError extends ProviderError {
  constructor(
    readonly detail?: string,
    opts?: { cause?: unknown },
  ) {
    super(`transient error before send${detail ? `: ${detail}` : ""}`, opts);
  }
}

export class AmbiguousSendError extends ProviderError {
  constructor(
    readonly detail?: string,
    opts?: { cause?: unknown },
  ) {
    super(`send outcome unknown${detail ? `: ${detail}` : ""}`, opts);
  }
}

/** Microsoft sign-in needs a tenant admin to approve the app (AADSTS65001, AADSTS90094). Only the connect flow sees it. */
export class AdminConsentRequiredError extends ProviderError {
  constructor(opts?: { cause?: unknown }) {
    super("admin consent required", opts);
  }
}
