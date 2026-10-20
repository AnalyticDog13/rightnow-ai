import {
  AmbiguousSendError,
  AuthError,
  PermanentSendError,
  RateLimitedError,
  TransientBeforeSendError,
} from "../errors";
import { parseRetryAfter } from "../retry-after";
import type { CredentialStore, OAuthClient, OAuthCreds } from "../types";

export type Clock = { now(): Date };
export const API = "https://gmail.googleapis.com/gmail/v1/users/me/";
const TIMEOUT_MS = 60_000;
const CONNECT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

type Query = Record<string, string | number | string[] | undefined>;
export type CallOpts = {
  method?: "GET" | "POST";
  query?: Query;
  body?: unknown;
  /** The send call: a 5xx or a rejection after the write is ambiguous, other 4xx are permanent. */
  send?: boolean;
  /** 404 resolves to null instead of throwing. */
  ok404?: boolean;
  signal?: AbortSignal;
};

/** Authed Gmail REST calls (D10: plain fetch). Errors are built from status and Google's `reason` only: bodies can hold tokens. */
export class GmailHttp {
  private f: typeof fetch;
  private clock: Clock;
  constructor(
    private store: CredentialStore<OAuthCreds>,
    private oauth: OAuthClient,
    o: { fetch?: typeof fetch; clock?: Clock } = {},
  ) {
    this.f = o.fetch ?? fetch;
    this.clock = o.clock ?? { now: () => new Date() };
  }

  private refresh = (c: OAuthCreds) => this.store.refresh(c, (x) => this.oauth.refresh(x));

  async call<T>(path: string, o: CallOpts & { ok404: true }): Promise<T | null>;
  async call<T>(path: string, o?: CallOpts): Promise<T>;
  async call<T>(path: string, o: CallOpts = {}): Promise<T | null> {
    let creds = await this.store.get();
    if (creds.expiresAt < this.clock.now().getTime() + 60_000) creds = await this.refresh(creds);
    for (let retried = false; ; retried = true) {
      const res = await this.once(path, o, creds);
      if (res.status !== 401) return this.handle<T>(res, o);
      // 401 means the request was not processed, so one refresh and one retry is safe even for send
      void res.body?.cancel().catch(() => {});
      if (retried) throw new AuthError("unauthorized");
      creds = await this.refresh(creds);
    }
  }

  private async once(path: string, o: CallOpts, creds: OAuthCreds): Promise<Response> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(o.query ?? {}))
      for (const x of [v].flat()) if (x !== undefined) qs.append(k, String(x));
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      return await this.f(`${API}${path}${qs.size ? `?${qs}` : ""}`, {
        method: o.method ?? "GET",
        headers: {
          authorization: `Bearer ${creds.accessToken}`,
          ...(o.body ? { "content-type": "application/json" } : {}),
        },
        body: o.body ? JSON.stringify(o.body) : undefined,
        signal: o.signal ? AbortSignal.any([signal, o.signal]) : signal,
      });
    } catch (e) {
      const code = (e as { cause?: { code?: string } }).cause?.code;
      if (code && CONNECT.has(code)) throw new TransientBeforeSendError("connection failed");
      // deliberately no cause
      throw o.send
        ? new AmbiguousSendError("request failed after it was written")
        : new TransientBeforeSendError("network error or timeout");
    }
  }

  private async handle<T>(res: Response, o: CallOpts): Promise<T | null> {
    if (res.ok) return (await res.json().catch(() => ({}))) as T;
    if (res.status === 404 && o.ok404) return (void res.body?.cancel().catch(() => {}), null);
    const body = (await res.json().catch(() => ({}))) as {
      error?: { errors?: { reason?: string }[]; status?: string };
    };
    const reason = body.error?.errors?.[0]?.reason ?? body.error?.status;
    const retryAfter = res.headers.get("retry-after");
    const wait = () => parseRetryAfter(retryAfter, this.clock.now());
    if (res.status === 429) throw new RateLimitedError(wait());
    if (res.status === 403) {
      if (reason === "dailyLimitExceeded") throw new RateLimitedError(3600);
      if (
        reason === "rateLimitExceeded" ||
        reason === "userRateLimitExceeded" ||
        reason === "quotaExceeded" ||
        reason === "concurrentLimitExceeded"
      )
        throw new RateLimitedError(wait());
      if (reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")
        throw new AuthError("scope_revoked");
      if (reason === "authError") throw new AuthError("unauthorized");
    }
    if (res.status >= 500) {
      if (o.send) throw new AmbiguousSendError(`gmail ${res.status}`);
      if ((res.status === 503 || res.status === 504) && retryAfter)
        throw new RateLimitedError(wait());
      throw new TransientBeforeSendError(`gmail ${res.status}`);
    }
    // unknown 403 on reads (domainPolicy, accessNotConfigured, no reason): AuthError would disconnect a healthy mailbox, so retry as transient
    if (res.status === 403 && !o.send) throw new TransientBeforeSendError("gmail 403");
    throw new PermanentSendError(reason ?? `http_${res.status}`, `gmail ${res.status}`);
  }
}
