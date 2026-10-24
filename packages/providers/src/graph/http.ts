import {
  AmbiguousSendError,
  AuthError,
  beforeRequest,
  PermanentSendError,
  RateLimitedError,
  TransientBeforeSendError,
} from "../errors";
import { parseRetryAfter } from "../retry-after";
import type { CredentialStore, OAuthClient, OAuthCreds } from "../types";

export type Clock = { now(): Date };
export const API = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 60_000;
const CONNECT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);
const THROTTLE = /throttl|quota|toomanyrequests|concurrency|serverbusy/i;

/** Cursors and page tokens come from our own database, but they are URLs we send a Bearer token to. */
export function assertGraphUrl(url: string): string {
  if (!url.startsWith(`${API}/`)) throw new TransientBeforeSendError("not a graph url");
  return url;
}

export type CallOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  /** Raw body (the base64 MIME draft) with its content type. */
  text?: string;
  /** The send call: a 5xx or a failure after the write is ambiguous, other 4xx are permanent. */
  send?: boolean;
  /** These statuses resolve to null instead of throwing (404 gone, 410 expired delta). */
  nullOn?: number[];
  /** `odata.maxpagesize` for delta. */
  pageSize?: number;
  as?: "json" | "buffer";
  signal?: AbortSignal;
};

/** Authed Graph v1.0 calls (D10: plain fetch). Errors are built from status and Graph's `error.code` only: bodies can hold tokens. */
export class GraphHttp {
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

  private refresh = (c: OAuthCreds) =>
    beforeRequest(() => this.store.refresh(c, (x) => this.oauth.refresh(x)));

  async call<T>(path: string, o: CallOpts & { nullOn: number[] }): Promise<T | null>;
  async call<T>(path: string, o?: CallOpts): Promise<T>;
  async call<T>(path: string, o: CallOpts = {}): Promise<T | null> {
    let creds = await beforeRequest(() => this.store.get());
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
      if (v !== undefined) qs.append(k, String(v));
    const url = path.startsWith("https://") ? assertGraphUrl(path) : `${API}${path}`;
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const prefer = [
      'IdType="ImmutableId"',
      ...(o.pageSize ? [`odata.maxpagesize=${o.pageSize}`] : []),
    ];
    try {
      return await this.f(`${url}${qs.size ? `${url.includes("?") ? "&" : "?"}${qs}` : ""}`, {
        method: o.method ?? "GET",
        headers: {
          authorization: `Bearer ${creds.accessToken}`,
          prefer: prefer.join(", "),
          ...(o.json !== undefined ? { "content-type": "application/json" } : {}),
          ...(o.text !== undefined ? { "content-type": "text/plain" } : {}),
        },
        body: o.text ?? (o.json !== undefined ? JSON.stringify(o.json) : undefined),
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
    if (res.ok) {
      if (o.as === "buffer") return Buffer.from(await res.arrayBuffer()) as T;
      return (await res.json().catch(() => ({}))) as T; // 202/204 have no body
    }
    if (o.nullOn?.includes(res.status)) return (void res.body?.cancel().catch(() => {}), null);
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    const code = typeof body.error?.code === "string" ? body.error.code : undefined;
    const retryAfter = res.headers.get("retry-after");
    const wait = () => parseRetryAfter(retryAfter, this.clock.now());
    if (res.status === 429) throw new RateLimitedError(wait());
    if (res.status === 403 && (THROTTLE.test(code ?? "") || retryAfter))
      throw new RateLimitedError(wait());
    if (res.status >= 500) {
      if (o.send) throw new AmbiguousSendError(`graph ${res.status}`);
      if ((res.status === 503 || res.status === 504) && retryAfter)
        throw new RateLimitedError(wait());
      throw new TransientBeforeSendError(`graph ${res.status}`);
    }
    // 403 without a throttle signal (mailbox not enabled, policy, unknown): AuthError would disconnect a healthy mailbox
    if (res.status === 403 && !o.send) throw new TransientBeforeSendError("graph 403");
    const scope =
      code === "ErrorInvalidRecipients"
        ? "recipient"
        : code === "ErrorSendAsDenied"
          ? "account"
          : undefined;
    throw new PermanentSendError(code ?? `http_${res.status}`, `graph ${res.status}`, { scope });
  }
}
