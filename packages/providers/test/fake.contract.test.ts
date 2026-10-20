import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider } from "../src";
import { runProviderContract } from "../src/contract/suite";

runProviderContract({
  name: "FakeProvider",
  supports: new Set([
    "rate_limit",
    "auth_revoked",
    "token_5xx",
    "api_5xx",
    "smtp_4xx",
    "smtp_5xx",
    "connect_refused",
    "timeout_after_write",
    "permanent_rejected",
    "removed",
    "locate",
    "expire",
  ]),
  async setup() {
    const dir = mkdtempSync(join(tmpdir(), "rn-fake-contract-"));
    const f = new FakeProvider("me@rn.test", { dir });
    return {
      provider: f,
      scenario: {
        receiveInbound: (m) => f.receiveInbound(m),
        seedInbound: (n) => f.seedInbound(n),
        receiveSpam: () => f.receiveSpam(),
        saveDraft: () => f.saveDraft(),
        sendExternal: (m) => f.sendExternal(m),
        deleteMessage: (id) => f.deleteMessage(id),
        failNext: (k) => f.failNext(k),
        expireCursors: () => f.expireCursors(),
        sentRaw: () => f.sentRaw(),
      },
      reopen: async () => new FakeProvider("me@rn.test", { dir }),
      close: async () => rmSync(dir, { recursive: true, force: true }),
    };
  },
});
