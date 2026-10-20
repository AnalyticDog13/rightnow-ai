import { GraphProvider, MicrosoftOAuth } from "../src";
import { runProviderContract } from "../src/contract/suite";
import { createFakeGraph } from "./graph-fake";

runProviderContract({
  name: "GraphProvider (fixture HTTP)",
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
    const g = createFakeGraph();
    const make = () =>
      new GraphProvider({
        address: "me@rn.test",
        store: g.store,
        oauth: new MicrosoftOAuth({
          clientId: "c",
          clientSecret: "s",
          tenant: "common",
          fetch: g.fetch,
        }),
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
