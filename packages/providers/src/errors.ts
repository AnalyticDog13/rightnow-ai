/** Error objects never carry response bodies (they contain tokens): build messages from status/codes only. */
export class ProviderError extends Error {
  declare cause?: unknown;
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

export class PermanentSendError extends ProviderError {
  constructor(
    readonly code: string,
    readonly detail?: string,
    opts?: { cause?: unknown },
  ) {
    super(`permanent send error: ${code}${detail ? ` (${detail})` : ""}`, opts);
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
