import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider, GmailProvider, GoogleOAuth, GraphProvider, MicrosoftOAuth } from "../src";
import { runPushContract } from "../src/contract/suite";
import { createFakeGmail } from "./gmail-fake";
import { createFakeGraph } from "./graph-fake";

runPushContract({
  name: "FakeProvider",
  setup: async () => ({
    provider: new FakeProvider("me@rn.test", { dir: mkdtempSync(join(tmpdir(), "rn-fake-push-")) }),
  }),
});
runPushContract({
  name: "GmailProvider (fixture HTTP)",
  setup: async () => {
    const g = createFakeGmail();
    return {
      provider: new GmailProvider({
        address: "me@rn.test",
        store: g.store,
        oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch: g.fetch }),
        fetch: g.fetch,
      }),
    };
  },
});
runPushContract({
  name: "GraphProvider (fixture HTTP)",
  setup: async () => {
    const g = createFakeGraph();
    return {
      provider: new GraphProvider({
        address: "me@rn.test",
        store: g.store,
        oauth: new MicrosoftOAuth({
          clientId: "c",
          clientSecret: "s",
          tenant: "common",
          fetch: g.fetch,
        }),
        fetch: g.fetch,
      }),
    };
  },
});
