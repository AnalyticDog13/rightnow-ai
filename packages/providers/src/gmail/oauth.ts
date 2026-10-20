import { AuthError, RateLimitedError, TransientBeforeSendError } from "../errors";
import { parseRetryAfter } from "../retry-after";
import type { OAuthClient, OAuthCreds } from "../types";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 15_000;

type Opts = { clientId: string; clientSecret: string; fetch?: typeof fetch; now?: () => number };
type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

/** D10: plain fetch. Errors are built from status and error codes only: response bodies hold tokens. */
export class GoogleOAuth implements OAuthClient {
  private f: typeof fetch;
  private now: () => number;
  constructor(private o: Opts) {
    this.f = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
  }

  authUrl(p: { state: string; codeChallenge: string; redirectUri: string; loginHint?: string }) {
    const q = new URLSearchParams({
      client_id: this.o.clientId,
      redirect_uri: p.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      state: p.state,
      code_challenge: p.codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });
    if (p.loginHint) q.set("login_hint", p.loginHint);
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new TransientBeforeSendError("network error or timeout"); // deliberately no cause
    }
  }

  private async token(params: Record<string, string>): Promise<TokenResponse> {
    const res = await this.send(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.o.clientId,
        client_secret: this.o.clientSecret,
        ...params,
      }).toString(),
    });
    if (res.ok) return (await res.json().catch(() => ({}))) as TokenResponse;
    if (res.status === 429)
      throw new RateLimitedError(
        parseRetryAfter(res.headers.get("retry-after"), new Date(this.now())),
      );
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    if (res.status >= 500 || code === "temporarily_unavailable")
      throw new TransientBeforeSendError(`token endpoint ${res.status}`);
    // an expired or wrong client secret is the operator's problem, not a mailbox's
    if (code === "invalid_client" || code === "unauthorized_client")
      throw new TransientBeforeSendError("Google app credentials invalid");
    throw new AuthError(code === "invalid_grant" ? "invalid_grant" : "unauthorized");
  }

  private creds(t: TokenResponse, refreshToken: string, scope: string): OAuthCreds {
    if (!t.access_token) throw new TransientBeforeSendError("token response without access_token");
    return {
      accessToken: t.access_token,
      refreshToken,
      expiresAt: this.now() + (t.expires_in ?? 3600) * 1000,
      scope: t.scope ?? scope,
    };
  }

  /** `refreshToken` is "" when Google sent none; the caller turns that into no_refresh_token. */
  async exchange(p: { code: string; codeVerifier: string; redirectUri: string }) {
    const t = await this.token({
      grant_type: "authorization_code",
      code: p.code,
      code_verifier: p.codeVerifier,
      redirect_uri: p.redirectUri,
    });
    const creds = this.creds(t, t.refresh_token ?? "", "");
    const res = await this.send("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });
    const email = res.ok
      ? ((await res.json().catch(() => ({}))) as { emailAddress?: string }).emailAddress
      : undefined;
    if (!email) throw new TransientBeforeSendError(`gmail profile ${res.status}`);
    return { creds, email: email.toLowerCase() };
  }

  async refresh(c: OAuthCreds): Promise<OAuthCreds> {
    const t = await this.token({ grant_type: "refresh_token", refresh_token: c.refreshToken });
    return this.creds(t, t.refresh_token ?? c.refreshToken, c.scope); // Google omits refresh_token here
  }

  async revoke(c: OAuthCreds): Promise<void> {
    const res = await this.send("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: c.refreshToken }).toString(),
    });
    if (!res.ok && res.status !== 400) throw new TransientBeforeSendError(`revoke ${res.status}`); // 400 = already invalid
  }
}
