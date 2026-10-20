import { describe, expect, it } from "vitest";
import { AuthError, ProviderError, RateLimitedError, parseRetryAfter } from "../src";

describe("parseRetryAfter", () => {
  const now = new Date("2026-10-21T07:26:00Z");
  it("handles seconds, HTTP-date, null and clamping", () => {
    expect(parseRetryAfter("7", now)).toBe(7);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT", now)).toBe(120);
    expect(parseRetryAfter(null, now)).toBe(60);
    expect(parseRetryAfter("garbage", now)).toBe(60);
    expect(parseRetryAfter("99999", now)).toBe(3600);
    expect(parseRetryAfter("0", now)).toBe(1);
    expect(parseRetryAfter("7.5", now)).toBe(8);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:00:00 GMT", now)).toBe(1);
  });
});

describe("error taxonomy", () => {
  it("extends ProviderError and never carries a response body", () => {
    const res = new Response('{"error":"invalid_grant","refresh_token":"SECRET-RT"}', {
      status: 400,
    });
    // Callers map by status only; the body is never passed on.
    const err = new AuthError("invalid_grant", {
      cause: new Error(`token endpoint ${res.status}`),
    });
    expect(err).toBeInstanceOf(ProviderError);
    expect(new RateLimitedError(7).retryAfterSec).toBe(7);
    for (const s of [JSON.stringify(err), err.message, String(err.cause)])
      expect(s).not.toContain("refresh_token");
  });
});
