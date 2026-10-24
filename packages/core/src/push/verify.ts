import { safeRequest } from "@rightnow/providers";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { z } from "zod";

const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const SKEW_SEC = 60;
const TTL_MS = 3_600_000;
const REFETCH_MS = 60_000;

type Cache = { keys: JWK[]; fresh: number; tried: number; loading?: Promise<void> };
/** One cache per fetcher, so the route's Google fetcher and a test's fixture never share keys. */
const caches = new WeakMap<() => Promise<JWK[]>, Cache>();

/**
 * The key for `kid`. The JWKS is cached for an hour; a miss refetches at most once a minute across all callers
 * (a failed fetch counts), so a flood of unknown `kid`s cannot turn into a fetch storm.
 */
async function keyFor(kid: string, jwks: () => Promise<JWK[]>, now: number) {
  let c = caches.get(jwks);
  if (!c) caches.set(jwks, (c = { keys: [], fresh: -Infinity, tried: -Infinity }));
  const cache = c;
  const find = () => cache.keys.find((k) => k.kid === kid && k.kty === "RSA");
  if (
    !cache.loading &&
    (now - cache.fresh >= TTL_MS || !find()) &&
    now - cache.tried >= REFETCH_MS
  ) {
    cache.tried = now;
    cache.loading = jwks()
      .then((keys) => {
        cache.keys = keys;
        cache.fresh = now;
      })
      .catch(() => {})
      .finally(() => (cache.loading = undefined));
  }
  if (cache.loading) await cache.loading; // concurrent callers share one fetch
  return find();
}

/**
 * D48: a Pub/Sub push OIDC token. RS256 only with a `kid` from Google's JWKS; `iss` Google, `aud` ours, `email` the
 * configured push service account with `email_verified` true, `exp`/`iat` within 60 s. Never throws.
 */
export async function verifyGoogleJwt(
  token: string,
  o: { audience: string; email: string; now: Date; jwks: () => Promise<JWK[]> },
): Promise<boolean> {
  try {
    const h = decodeProtectedHeader(token);
    if (h.alg !== "RS256" || typeof h.kid !== "string" || !h.kid) return false;
    const jwk = await keyFor(h.kid, o.jwks, o.now.getTime());
    if (!jwk) return false;
    const { payload } = await jwtVerify(token, await importJWK({ ...jwk, alg: "RS256" }, "RS256"), {
      algorithms: ["RS256"],
      issuer: ISSUERS,
      audience: o.audience,
      currentDate: o.now,
      clockTolerance: SKEW_SEC,
      maxTokenAge: TTL_MS / 1000, // makes `iat` required and rejects one more than 60 s ahead
      requiredClaims: ["exp", "email"],
    });
    return payload.email === o.email && payload.email_verified === true;
  } catch {
    return false;
  }
}

const jwksBody = z.object({ keys: z.array(z.record(z.string(), z.unknown())).max(50) });

/** Google's JWKS through the outbound guard (public hosts only, capped, no redirects). Call outside any transaction. */
export async function googleJwks(): Promise<JWK[]> {
  const r = await safeRequest("https://www.googleapis.com/oauth2/v3/certs", {
    method: "GET",
    timeoutMs: 5_000,
    maxResponseBytes: 64 * 1024,
    allowPrivate: false,
  });
  if (r.status !== 200) throw new Error(`jwks_status_${r.status}`);
  return jwksBody.parse(JSON.parse(r.body.toString("utf8"))).keys as JWK[];
}
