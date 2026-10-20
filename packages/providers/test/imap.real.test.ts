import { ImapFlow } from "imapflow";
import { describe, it } from "vitest";
import { ImapSmtpProvider, type MailProvider } from "../src";
import { runProviderContract, type ProviderHarness } from "../src/contract/suite";
import { mailboxScenario } from "./imap-harness";

/**
 * The whole provider contract against a real server: GreenMail (IMAP + SMTP, no CONDSTORE), started by the
 * `imap-real` CI job. IMAP_TEST_URL=imap://me:secret@127.0.0.1:3143?smtp=3025&address=me@rn.test
 * The host must be loopback: plain ports are allowed only for a loopback host in MODE=local.
 * Failure injection (4xx, 5xx, resets, revoked passwords) cannot be driven on a real server and is covered
 * by imap.contract.test.ts and imap.test.ts.
 */
const raw = process.env.IMAP_TEST_URL;

if (!raw) {
  describe("MailProvider contract: ImapSmtpProvider (GreenMail)", () => {
    it.skip("needs IMAP_TEST_URL (runs in the imap-real CI job)", () => {});
  });
} else {
  const url = new URL(raw);
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname))
    throw new Error("IMAP_TEST_URL must point at 127.0.0.1: plain ports are for loopback only");
  const host = url.hostname;
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  const imapPort = Number(url.port);
  const smtpPort = Number(url.searchParams.get("smtp"));
  const address = url.searchParams.get("address")!;
  /** Where the contract's recipients (to@, hidden@) can be read back: their own GreenMail users. */
  const RECIPIENTS = ["to", "hidden"];

  const connect = async (login: string) => {
    const c = new ImapFlow({
      host,
      port: imapPort,
      secure: false,
      doSTARTTLS: false,
      auth: { user: login, pass },
      logger: false,
    });
    c.on("error", () => {});
    await c.connect();
    return c;
  };
  const as =
    (login: string) =>
    async <T>(fn: (c: ImapFlow) => Promise<T>) => {
      const c = await connect(login);
      try {
        return await fn(c);
      } finally {
        await c.logout().catch(() => {});
      }
    };
  const admin = as(user);
  const empty = async (c: ImapFlow, path: string) => {
    const lock = await c.getMailboxLock(path);
    try {
      if ((c.mailbox as { exists: number }).exists > 0) await c.messageDelete("1:*"); // flags \Deleted and expunges
    } finally {
      lock.release();
    }
  };
  /** A fresh, empty mailbox: Sent, Junk and Drafts exist (GreenMail starts with INBOX only) and hold nothing. */
  const reset = async () => {
    await admin(async (c) => {
      const have = new Set((await c.list()).map((b) => b.path));
      for (const name of ["Sent", "Junk", "Drafts"])
        if (!have.has(name)) await c.mailboxCreate(name);
      for (const name of ["INBOX", "Sent", "Junk", "Drafts"]) await empty(c, name);
    });
    for (const r of RECIPIENTS) await as(r)((c) => empty(c, "INBOX"));
  };

  const make = (): MailProvider =>
    new ImapSmtpProvider({
      address,
      credentials: async () => ({
        imap: { host, port: imapPort, secure: false, username: user, password: pass },
        smtp: { host, port: smtpPort, secure: false, username: user, password: pass },
      }),
      appendToSent: true, // GreenMail does not file Sent copies
      mode: "local",
      allowPrivate: false,
    });

  const harness: ProviderHarness = {
    name: "ImapSmtpProvider (GreenMail)",
    supports: new Set(["locate", "expire"]),
    async setup() {
      await reset();
      return {
        provider: make(),
        scenario: {
          ...mailboxScenario(admin, "Sent"),
          failNext() {
            throw new Error("failure injection is not supported on a real server");
          },
          async sentRaw() {
            const out: Buffer[] = [];
            await as("to")(async (c) => {
              const lock = await c.getMailboxLock("INBOX", { readOnly: true });
              try {
                if ((c.mailbox as { exists: number }).exists > 0)
                  for await (const m of c.fetch("1:*", { source: true }))
                    if (m.source) out.push(m.source);
              } finally {
                lock.release();
              }
            });
            return out;
          },
        },
        reopen: async () => make(),
        close: async () => {},
      };
    },
  };
  runProviderContract(harness);
}
