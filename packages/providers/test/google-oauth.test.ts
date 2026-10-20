import { expect, test } from "vitest";
import {
  AuthError,
  GoogleOAuth,
  RateLimitedError,
  TransientBeforeSendError,
  createFixtureFetch,
} from "../src";

const creds = { accessToken: "at-old", refreshToken: "rt-old", expiresAt: 1, scope: "s" };
const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const client = (...sequence: Response[]) => {
  const fetch = createFixtureFetch([{ method: "POST", url: /token|revoke/, sequence }]);
  return {
    fetch,
    g: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch, now: () => 1000 }),
  };
};

test("refresh keeps the old refresh token when Google sends none", async () => {
  const { g, fetch } = client(reply(200, { access_token: "at-new", expires_in: 60 }));
  expect(await g.refresh(creds)).toEqual({ ...creds, accessToken: "at-new", expiresAt: 61_000 });
  expect(new URLSearchParams(fetch.calls[0]!.body).get("grant_type")).toBe("refresh_token");
});

test("refresh error mapping", async () => {
  const { g } = client(
    reply(400, { error: "invalid_grant" }),
    reply(503, { error: "backend_error" }),
    reply(429, {}, { "retry-after": "7" }),
    reply(400, { error: "temporarily_unavailable" }),
  );
  await expect(g.refresh(creds)).rejects.toEqual(new AuthError("invalid_grant"));
  await expect(g.refresh(creds)).rejects.toBeInstanceOf(TransientBeforeSendError);
  await expect(g.refresh(creds)).rejects.toMatchObject({ retryAfterSec: 7 });
  await expect(g.refresh(creds)).rejects.toBeInstanceOf(TransientBeforeSendError);
  expect(RateLimitedError).toBeDefined();
});

test("revoke tolerates an already-invalid token, not a 500", async () => {
  const { g } = client(reply(200), reply(400), reply(500));
  await g.revoke(creds);
  await g.revoke(creds);
  await expect(g.revoke(creds)).rejects.toBeInstanceOf(TransientBeforeSendError);
});

test("an unrecognized 4xx is transient on refresh and a plain failure on exchange", async () => {
  const { g } = client(
    reply(400, { error: "invalid_request" }),
    reply(403, {}),
    reply(400, { error: "invalid_client" }),
    reply(400, { error: "invalid_scope" }),
  );
  await expect(g.refresh(creds)).rejects.toBeInstanceOf(TransientBeforeSendError);
  await expect(g.refresh(creds)).rejects.toBeInstanceOf(TransientBeforeSendError);
  await expect(g.refresh(creds)).rejects.toBeInstanceOf(TransientBeforeSendError);
  await expect(
    g.exchange({ code: "c", codeVerifier: "v", redirectUri: "http://x/cb" }),
  ).rejects.toEqual(new AuthError("unauthorized"));
});
