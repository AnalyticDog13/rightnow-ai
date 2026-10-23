import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { ProviderError, TransientBeforeSendError } from "./errors";
import { assertPublicHost } from "./net";

export type SafeResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  latencyMs: number;
};

/** Codes: bad_url, host_not_public, timeout, connect_failed, response_too_large. Never carries a body. */
export class HttpOutError extends ProviderError {
  constructor(
    readonly code: string,
    /** The status line already received (response_too_large), so a caller can still count a 2xx. */
    readonly status?: number,
  ) {
    super(`http request failed: ${code}`);
  }
}

/**
 * Outbound HTTP to a user-supplied URL (webhooks, AI base URL, email verifier). Private hosts are refused in every
 * mode unless `allowPrivate`; cloud metadata always (R24). The host is resolved once and the socket goes to exactly
 * that address (`lookup` pinned), so Host and TLS SNI still come from the URL and DNS rebinding cannot redirect it.
 * Redirects are returned, never followed. `timeoutMs` covers DNS, connect and the whole response.
 */
export async function safeRequest(
  url: string,
  o: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string | Buffer;
    timeoutMs: number;
    maxResponseBytes: number;
    allowPrivate: boolean;
    resolve?: (h: string) => Promise<string[]>;
    signal?: AbortSignal;
  },
): Promise<SafeResponse> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpOutError("bad_url");
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password)
    throw new HttpOutError("bad_url");
  const start = Date.now();
  const timeout = AbortSignal.timeout(o.timeoutMs);
  const signal = o.signal ? AbortSignal.any([timeout, o.signal]) : timeout;
  const aborted = new Promise<never>((_, rej) => {
    const stop = () => rej(new HttpOutError("timeout"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  aborted.catch(() => {});

  let address: string;
  try {
    ({ address } = await Promise.race([
      assertPublicHost(u.hostname, {
        mode: "vps",
        allowPrivate: o.allowPrivate,
        resolve: o.resolve,
      }),
      aborted,
    ]));
  } catch (e) {
    if (e instanceof HttpOutError) throw e;
    throw new HttpOutError(
      e instanceof TransientBeforeSendError ? "connect_failed" : "host_not_public",
    );
  }
  const family = isIP(address);
  const lookup = ((_h, opts, cb) =>
    opts.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as LookupFunction;
  const body = o.body === undefined ? undefined : Buffer.from(o.body);

  return new Promise<SafeResponse>((resolve, reject) => {
    let done = false;
    const fail = (e: HttpOutError) => {
      if (done) return;
      done = true;
      req.destroy();
      reject(e);
    };
    const req = (u.protocol === "https:" ? https : http).request(
      {
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[|\]$/g, ""),
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: o.method,
        headers: { ...o.headers, ...(body && { "content-length": String(body.length) }) },
        lookup,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let n = 0;
        res.on("data", (c: Buffer) => {
          n += c.length;
          if (n > o.maxResponseBytes) {
            res.destroy();
            return fail(new HttpOutError("response_too_large", res.statusCode));
          }
          chunks.push(c);
        });
        res.on("end", () => {
          if (done) return;
          done = true;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers))
            if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks),
            latencyMs: Date.now() - start,
          });
        });
        res.on("error", () =>
          fail(new HttpOutError(signal.aborted ? "timeout" : "connect_failed")),
        );
      },
    );
    aborted.catch((e: HttpOutError) => fail(e));
    req.on("error", () => fail(new HttpOutError(signal.aborted ? "timeout" : "connect_failed")));
    req.end(body);
  });
}
