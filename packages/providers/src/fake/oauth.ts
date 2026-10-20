import { AuthError } from "../errors";
import type { OAuthClient, OAuthCreds } from "../types";

let n = 0;
const creds = (refreshToken: string): OAuthCreds => ({
  accessToken: `fake-at-${++n}`,
  refreshToken,
  expiresAt: Date.now() + 3600_000,
  scope: "fake",
});

/** Redirects straight back with `code=fake:<email>`; no network. */
export class FakeOAuthClient implements OAuthClient {
  authUrl(p: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    loginHint?: string;
  }): string {
    return `${p.redirectUri}?code=fake:${p.loginHint ?? "fake@example.test"}&state=${p.state}`;
  }

  async exchange(p: { code: string; codeVerifier: string; redirectUri: string }) {
    const email = p.code.startsWith("fake:") ? p.code.slice(5).toLowerCase() : "";
    if (!email.includes("@")) throw new AuthError("invalid_grant");
    return { creds: creds(`fake-rt-${email}`), email, displayName: email.split("@")[0] };
  }

  async refresh(c: OAuthCreds): Promise<OAuthCreds> {
    return creds(c.refreshToken);
  }

  async revoke(): Promise<void> {}
}
