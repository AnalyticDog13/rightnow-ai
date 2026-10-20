import { GmailProvider, GoogleOAuth } from "../src";
import { runProviderContract } from "../src/contract/suite";
import { createFakeGmail } from "./gmail-fake";

runProviderContract({
  name: "GmailProvider (fixture HTTP)",
  supports: new Set([
    "rate_limit",
    "auth_revoked",
    "token_5xx",
    "api_5xx",
    "connect_refused",
    "timeout_after_write",
    "permanent_rejected",
    "removed",
    "locate",
    "expire",
  ]),
  async setup() {
    const g = createFakeGmail();
    const make = () =>
      new GmailProvider({
        address: "me@rn.test",
        store: g.store,
        oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch: g.fetch }),
        fetch: g.fetch,
      });
    return {
      provider: make(),
      scenario: g.scenario,
      reopen: async () => make(),
      close: async () => {},
    };
  },
});
