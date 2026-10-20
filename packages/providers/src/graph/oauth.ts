import {
  AdminConsentRequiredError,
  AuthError,
  RateLimitedError,
  TransientBeforeSendError,
} from "../errors";
import { parseRetryAfter } from "../retry-after";
import type { OAuthClient, OAuthCreds } from "../types";

export const MS_SCOPES = "offline_access User.Read Mail.Send Mail.ReadWrite";
/** What a grant must contain; Microsoft may echo them as full `https://graph.microsoft.com/...` URLs. */
export const MS_REQUIRED_SCOPES = ["Mail.Send", "Mail.ReadWrite"];
export const normalizeScopes = (scope: string) =>
  scope.split(" ").map((s) => s.replace("https://graph.microsoft.com/", ""));
const TIMEOUT_MS = 15_000;
const ME = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName";

type Opts = {
  clientId: string;
  clientSecret: string;
  /** common | organizations | consumers | a tenant id */
  tenant: string;
  fetch?: typeof fetch;
  now?: () => number;
};
type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

/** D10: plain fetch, no MSAL. Errors are built from status and error codes only: response bodies hold tokens. */
export class MicrosoftOAuth implements OAuthClient {
  private f: typeof fetch;
  private now: () => number;
  private base: string;
  constructor(private o: Opts) {
    this.f = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.base = `https://login.microsoftonline.com/${encodeURIComponent(o.tenant)}/oauth2/v2.0/`;
  }

  authUrl(p: { state: string; codeChallenge: string; redirectUri: string; loginHint?: string }) {
    const q = new URLSearchParams({
      client_id: this.o.clientId,
      redirect_uri: p.redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: MS_SCOPES,
      state: p.state,
      code_challenge: p.codeChallenge,
      code_challenge_method: "S256",
    });
    if (p.loginHint) q.set("login_hint", p.loginHint);
    return `${this.base}authorize?${q}`;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new TransientBeforeSendError("network error or timeout"); // deliberately no cause
    }
  }

  private async token(params: Record<string, string>): Promise<TokenResponse> {
    const refresh = params.grant_type === "refresh_token";
    const res = await this.send(`${this.base}token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.o.clientId,
        client_secret: this.o.clientSecret,
        scope: MS_SCOPES,
        ...params,
      }).toString(),
    });
    if (res.ok) return (await res.json().catch(() => ({}))) as TokenResponse;
    if (res.status === 429)
      throw new RateLimitedError(
        parseRetryAfter(res.headers.get("retry-after"), new Date(this.now())),
      );
    if (res.status >= 500) throw new TransientBeforeSendError(`token endpoint ${res.status}`);
    const b = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
      error_codes?: number[];
    };
    if (b.error === "temporarily_unavailable")
      throw new TransientBeforeSendError(`token endpoint ${res.status}`);
    // admin approval / consent missing: the description is read here and never copied into the error
    if (
      b.error_codes?.some((c) => c === 65001 || c === 90094) ||
      /AADSTS(65001|90094)/.test(b.error_description ?? "")
    )
      throw refresh ? new AuthError("scope_revoked") : new AdminConsentRequiredError();
    if (b.error === "invalid_grant" || b.error === "interaction_required")
      throw new AuthError("invalid_grant");
    if (b.error === "invalid_client") throw new AuthError("bad_credentials");
    // an unrecognized 4xx must not disconnect a healthy mailbox, but a failed first sign-in is a plain failure
    if (refresh) throw new TransientBeforeSendError(`token endpoint ${res.status}`);
    throw new AuthError("unauthorized");
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

  /** `refreshToken` is "" when none came back; the caller turns that into no_refresh_token. */
  async exchange(p: { code: string; codeVerifier: string; redirectUri: string }) {
    const t = await this.token({
      grant_type: "authorization_code",
      code: p.code,
      code_verifier: p.codeVerifier,
      redirect_uri: p.redirectUri,
    });
    const creds = this.creds(t, t.refresh_token ?? "", "");
    const res = await this.send(ME, {
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        prefer: 'IdType="ImmutableId"',
      },
    });
    const me = res.ok
      ? ((await res.json().catch(() => ({}))) as {
          mail?: string | null;
          userPrincipalName?: string;
          displayName?: string;
        })
      : {};
    const email = me.mail || me.userPrincipalName;
    if (!email) throw new TransientBeforeSendError(`graph /me ${res.status}`);
    return {
      creds,
      email: email.toLowerCase(),
      ...(me.displayName ? { displayName: me.displayName } : {}),
    };
  }

  async refresh(c: OAuthCreds): Promise<OAuthCreds> {
    const t = await this.token({ grant_type: "refresh_token", refresh_token: c.refreshToken });
    return this.creds(t, t.refresh_token ?? c.refreshToken, c.scope); // keep the old one if Microsoft omits it
  }

  /** Graph has no per-token revocation, and revokeSignInSessions would sign the user out everywhere. */
  async revoke(): Promise<void> {}
}
