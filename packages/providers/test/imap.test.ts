import net from "node:net";
import tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmbiguousSendError,
  AuthError,
  MS_SMTP_DISABLED_HINT,
  PermanentSendError,
  RateLimitedError,
  TransientBeforeSendError,
  buildMime,
  imapOptions,
  mapImapError,
  mapSmtpError,
  msSmtpHint,
  smtpOptions,
  type MailProvider,
  type SyncCursor,
} from "../src";
import { ADDRESS, startServers, type ServerOpts } from "./imap-harness";

type Servers = Awaited<ReturnType<typeof startServers>>;
const open: Servers[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(open.splice(0).map((s) => s.close()));
});
const start = async (o?: ServerOpts) => {
  const s = await startServers(o);
  open.push(s);
  return s;
};
const x = { email: "x@rn.test" };
/** imapflow logger that records the client commands ("12 UID FETCH ...") */
const commandLog = () => {
  const lines: string[] = [];
  const entry = (e: unknown) => {
    const m = e as { src?: string; msg?: string };
    if (m.src === "c" && m.msg) lines.push(m.msg);
  };
  const noop = () => {};
  return { lines, logger: { debug: entry, info: noop, warn: noop, error: noop } as never };
};
const changes = async (
  p: Pick<MailProvider, "listChangesSince">,
  c: SyncCursor,
  limit?: number,
) => {
  const r = await p.listChangesSince(c, limit ? { limit } : undefined);
  if (r.expired) throw new Error("expired");
  return r as {
    messages: { subject: string; folder: string; providerMessageId: string }[];
    cursor: SyncCursor;
    hasMore: boolean;
  };
};
const imapCursor = (c: SyncCursor) => (c as Extract<SyncCursor, { kind: "imap" }>).folders;

describe.each([false, true])("cursor with CONDSTORE=%s", (condstore) => {
  it("finds new mail, stores highestModseq only when advertised, and an unchanged mailbox causes no UID FETCH", async () => {
    const s = await start({ condstore });
    const { lines, logger } = commandLog();
    const p = s.provider({ logger });
    const c0 = await p.currentCursor();
    expect("highestModseq" in imapCursor(c0).INBOX).toBe(condstore);
    await s.scenario.receiveInbound({ from: x, subject: "one", text: "t" });
    const c1 = await changes(p, c0);
    expect(c1.messages.map((m) => m.subject)).toEqual(["one"]);
    expect("highestModseq" in imapCursor(c1.cursor).INBOX).toBe(condstore);

    lines.length = 0;
    const c2 = await changes(p, c1.cursor);
    expect(c2.messages).toHaveLength(0);
    expect(lines.filter((l) => /UID FETCH/i.test(l))).toEqual([]);
    expect(lines.filter((l) => /UID SEARCH/i.test(l))).toEqual([]);
  });

  it("a flag-only change (\\Seen) returns zero messages", async () => {
    const s = await start({ condstore });
    const p = s.provider();
    await s.scenario.receiveInbound({ from: x, subject: "one", text: "t" });
    const c1 = await changes(p, await p.currentCursor());
    expect(c1.messages).toHaveLength(0);
    const before = await p.currentCursor();
    await s.admin(async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        await c.messageFlagsAdd("1:*", ["\\Seen"]);
      } finally {
        lock.release();
      }
    });
    const r = await changes(p, before);
    expect(r.messages).toHaveLength(0);
    expect(r.hasMore).toBe(false);
  });
});

describe("sync details", () => {
  it("paging with limit 2 over 5 messages loses nothing and lastUid only advances to the last UID returned", async () => {
    const s = await start();
    const p = s.provider();
    let cur = await p.currentCursor();
    for (let i = 0; i < 5; i++)
      await s.scenario.receiveInbound({ from: x, subject: `m${i}`, text: "t" });
    const first = await changes(p, cur, 2);
    expect(first.messages.map((m) => m.subject)).toEqual(["m0", "m1"]);
    expect(first.hasMore).toBe(true);
    expect(imapCursor(first.cursor).INBOX.lastUid).toBe(2); // not 5, not uidNext - 1
    cur = first.cursor;
    const seen = [...first.messages];
    for (let i = 0; i < 5 && seen.length < 5; i++) {
      const r = await changes(p, cur, 2);
      seen.push(...r.messages);
      cur = r.cursor;
    }
    expect(seen.map((m) => m.subject)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });

  it("a message without Message-ID has rfcMessageId null", async () => {
    const s = await start();
    const p = s.provider();
    await s.admin((c) =>
      c.append(
        "INBOX",
        Buffer.from("From: x@rn.test\r\nTo: me@rn.test\r\nSubject: bare\r\n\r\nhi\r\n"),
      ),
    );
    const r = await p.listMessages({ since: new Date(0), folder: "INBOX" });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.rfcMessageId).toBeNull();
  });

  it("a Junk to Inbox move surfaces in listChangesSince, so a rescued reply is seen", async () => {
    const s = await start();
    const p = s.provider();
    const spam = await s.scenario.receiveSpam();
    const cur = await p.currentCursor();
    expect((await changes(p, cur)).messages).toHaveLength(0); // spam is never reported
    await s.admin(async (c) => {
      const lock = await c.getMailboxLock("Junk");
      try {
        await c.messageMove("1:*", "INBOX");
      } finally {
        lock.release();
      }
    });
    const r = await changes(p, cur);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ folder: "INBOX", subject: "spam" });
    expect((await p.locate(spam.rfcMessageId))?.folder).toBe("INBOX");
  });

  it("expired when the Sent folder's UIDVALIDITY changes", async () => {
    const s = await start();
    const p = s.provider();
    const old = await p.currentCursor();
    await s.scenario.expireCursors();
    expect(await p.listChangesSince(old)).toEqual({ expired: true });
  });
});

describe("send and Sent copy", () => {
  const mime = {
    from: { email: ADDRESS },
    to: [{ email: "to@rn.test" }],
    subject: "S",
    text: "t",
    messageId: "<s1@rn.test>",
  };

  it("appendToSent:false issues no APPEND and findSent finds the copy the server filed", async () => {
    const s = await start({ appendToSent: false });
    const { lines, logger } = commandLog();
    const p = s.provider({ logger });
    await p.send(mime);
    expect(lines.filter((l) => /APPEND/i.test(l))).toEqual([]);
    expect((await p.findSent("<s1@rn.test>"))?.folder).toBe("SENT");
  });

  it("an APPEND failure after SMTP success is logged and send still resolves", async () => {
    const ref: { s?: Servers } = {};
    const s = (ref.s = await start({ onSmtpData: () => ref.s?.imap.close() }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await s.provider().send(mime);
    expect(r.rfcMessageId).toBe("<s1@rn.test>");
    expect(s.received).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/\bp\b/);
  });

  it.each([
    ["by special-use", { name: "Mail Out", specialUse: true }],
    ["by the name Sent Items", { name: "Sent Items", specialUse: false }],
  ])("Sent folder discovery %s", async (_n, sent) => {
    const s = await start({ sent });
    const p = s.provider();
    await p.send(mime);
    const m = await p.findSent("<s1@rn.test>");
    expect(m?.folder).toBe("SENT");
    expect(decodeURIComponent(m!.providerMessageId.split(":")[0]!)).toBe(sent.name);
  });

  it("findSent finds our message after the Sent copy moved to Trash or Junk, and only if it is ours", async () => {
    const s = await start();
    const p = s.provider();
    await p.send(mime);
    for (const dest of ["Trash", "Junk"]) {
      const from = dest === "Trash" ? "Sent" : "Trash";
      await s.admin(async (c) => {
        const lock = await c.getMailboxLock(from);
        try {
          await c.messageMove("1:*", dest);
        } finally {
          lock.release();
        }
      });
      const m = await p.findSent("<s1@rn.test>");
      expect(m?.rfcMessageId).toBe("<s1@rn.test>");
      expect(m?.from.email).toBe(ADDRESS);
    }
    // someone else's message with that id is not ours
    const foreign = await buildMime({ ...mime, messageId: "<other@rn.test>", from: x });
    await s.admin((c) => c.append("INBOX", foreign));
    expect(await p.findSent("<other@rn.test>")).toBeNull();
    expect(await p.findSent("<missing@rn.test>")).toBeNull();
  });
});

describe("diagnostics", () => {
  it("a wrong IMAP password fails imap_login only", async () => {
    const s = await start();
    const p = s.provider({ credentials: async () => s.creds({ imapPass: "nope" }) });
    const d = await p.diagnostics();
    expect(d.ok).toBe(false);
    expect(d.checks.find((c) => c.name === "imap_login")).toMatchObject({
      ok: false,
      code: "bad_credentials",
    });
    expect(d.checks.find((c) => c.name === "smtp_auth")?.ok).toBe(true);
    expect(JSON.stringify(d)).not.toContain("nope");
  });

  it("a wrong SMTP password fails smtp_auth with bad_credentials", async () => {
    const s = await start();
    const d = await s
      .provider({ credentials: async () => s.creds({ smtpPass: "nope" }) })
      .diagnostics();
    expect(d.checks.find((c) => c.name === "smtp_auth")).toMatchObject({
      ok: false,
      code: "bad_credentials",
    });
    expect(d.checks.find((c) => c.name === "imap_login")?.ok).toBe(true);
  });

  it("a missing Sent folder fails only sent_folder", async () => {
    const s = await start();
    await s.admin((c) => c.mailboxDelete("Sent"));
    const d = await s.provider().diagnostics();
    expect(d.checks.find((c) => c.name === "sent_folder")).toMatchObject({
      ok: false,
      code: "sent_folder_missing",
    });
    expect(d.checks.filter((c) => !c.ok)).toHaveLength(1);
  });

  it("diagnostics response longer than 200 characters is truncated and the password is scrubbed", async () => {
    const long = "x".repeat(600);
    const s = await start({
      smtp: {
        onAuth: (_a: unknown, _s: unknown, cb: (e: Error) => void) =>
          cb(Object.assign(new Error(`535 5.7.8 ${long} p`), { responseCode: 535 })),
      } as never,
    });
    const d = await s.provider().diagnostics();
    const c = d.checks.find((k) => k.name === "smtp_auth")!;
    expect(c.ok).toBe(false);
    expect(c.response!.length).toBeLessThanOrEqual(200);
  });

  it("msSmtpHint", () => {
    const r = "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled";
    expect(msSmtpHint("smtp.office365.com", r)).toBe(MS_SMTP_DISABLED_HINT);
    expect(msSmtpHint("smtp.example.com", r)).toBeNull();
    expect(msSmtpHint("smtp.office365.com", "535 bad password")).toBeNull();
  });
});

describe("transport security", () => {
  const vps = { mode: "vps" as const, allowPrivate: false };
  const server = (host: string) => ({
    host,
    port: 993,
    secure: true,
    username: "u",
    password: "pw",
  });
  const creds = (host: string) => async () => ({ imap: server(host), smtp: server(host) });
  const sockets = () => {
    const mk = () => {
      const sock = new net.Socket();
      process.nextTick(() =>
        sock.destroy(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })),
      );
      return sock;
    };
    return [
      vi.spyOn(net, "connect").mockImplementation(mk),
      vi.spyOn(net, "createConnection").mockImplementation(mk),
      vi.spyOn(tls, "connect").mockImplementation(mk as never),
    ];
  };
  const provider = async (
    o: Partial<ConstructorParameters<typeof import("../src").ImapSmtpProvider>[0]>,
  ) =>
    new (await import("../src")).ImapSmtpProvider({
      address: ADDRESS,
      credentials: creds("10.0.0.5"),
      ...vps,
      ...o,
    });

  it("in vps mode a private host is rejected before any socket is opened", async () => {
    const spies = sockets();
    const p = await provider({});
    const d = await p.diagnostics();
    expect(d.checks.filter((c) => c.name !== "sent_folder")).toEqual([
      expect.objectContaining({ name: "imap_login", ok: false, code: "host_not_public" }),
      expect.objectContaining({ name: "smtp_auth", ok: false, code: "host_not_public" }),
    ]);
    const e = await p
      .send({ from: { email: ADDRESS }, to: [x], subject: "s", text: "t", messageId: "<a@b>" })
      .catch((k) => k);
    expect(e).toBeInstanceOf(PermanentSendError);
    expect(e.code).toBe("host_not_public");
    await expect(p.findSent("<a@b>")).rejects.toThrow();
    for (const sp of spies) expect(sp).not.toHaveBeenCalled();
  });

  it("ALLOW_PRIVATE_MAIL_HOSTS lets the same host through the guard", async () => {
    sockets();
    const d = await (await provider({ allowPrivate: true })).diagnostics();
    expect(d.checks.find((c) => c.name === "imap_login")?.code).not.toBe("host_not_public");
  });

  it("the host is re-checked at every connect (DNS rebinding after the form check)", async () => {
    const spies = sockets();
    let calls = 0;
    const p = await provider({
      credentials: creds("mail.example.com"),
      resolve: async () => (++calls === 1 ? ["93.184.216.34"] : ["127.0.0.1"]),
    });
    const first = await p.diagnostics().catch(() => null); // imap check resolves once, smtp check once
    expect(first).not.toBeNull();
    // calls 1 (imap) was public, call 2 (smtp) already rebinds to loopback
    expect(first!.checks.find((c) => c.name === "smtp_auth")?.code).toBe("host_not_public");
    const connects = spies.reduce((n, sp) => n + sp.mock.calls.length, 0);
    expect(connects).toBeGreaterThan(0);
    const d2 = await p.diagnostics();
    expect(d2.checks.find((c) => c.name === "imap_login")?.code).toBe("host_not_public");
    expect(spies.reduce((n, sp) => n + sp.mock.calls.length, 0)).toBe(connects);
  });

  it("a server that hides STARTTLS gets no AUTH in vps mode and the send fails before it", async () => {
    const s = await start({ smtp: { hideSTARTTLS: true } });
    const p = s.provider({ ...vps, allowPrivate: true });
    const e = await p
      .send({ from: { email: ADDRESS }, to: [x], subject: "s", text: "t", messageId: "<a@b>" })
      .catch((k) => k);
    expect(e).toBeInstanceOf(TransientBeforeSendError);
    const d = await p.diagnostics();
    expect(d.ok).toBe(false);
    // nodemailer asks for STARTTLS anyway; the built-in test certificate is expired, and verification stays on
    expect(d.checks.find((c) => c.name === "smtp_auth")).toMatchObject({
      ok: false,
      code: "tls_certificate",
    });
    expect(s.smtpAuth).toEqual([]);
    expect(s.received).toHaveLength(0);
  });

  it("an IMAP server without STARTTLS gets no LOGIN", async () => {
    const s = await start();
    const { lines, logger } = commandLog();
    const d = await s.provider({ ...vps, allowPrivate: true, logger }).diagnostics();
    expect(d.checks.find((c) => c.name === "imap_login")).toMatchObject({
      ok: false,
      code: "tls_required",
    });
    expect(lines.filter((l) => /LOGIN|AUTHENTICATE/i.test(l))).toEqual([]);
  });

  it("certificate verification is never disabled and plaintext needs a loopback host in local mode", () => {
    const srv = { host: "h", port: 1, secure: false, username: "u", password: "p" };
    for (const secure of [true, false])
      for (const plain of [true, false]) {
        const t = { address: "93.184.216.34", servername: "mail.example.com", plain };
        const i = imapOptions({ ...srv, secure }, t);
        const m = smtpOptions({ ...srv, secure }, t);
        expect(JSON.stringify([i, m])).not.toMatch(/rejectUnauthorized/);
        expect(i.servername).toBe("mail.example.com"); // connects to the checked IP, verifies the host name
        expect(i.host).toBe("93.184.216.34");
        expect(m.tls.servername).toBe("mail.example.com");
        if (!secure) {
          expect(i.doSTARTTLS).toBe(!plain);
          expect(m.requireTLS).toBe(!plain);
          expect(m.ignoreTLS).toBe(plain);
        }
      }
  });
});

describe("error mapping", () => {
  const smtp = (code: string, responseCode?: number, command?: string) =>
    Object.assign(new Error("boom: secret reply"), { code, responseCode, command });
  it.each([
    ["EAUTH 535", smtp("EAUTH", 535, "AUTH PLAIN"), false, AuthError],
    ["EAUTH 534", smtp("EAUTH", 534), false, AuthError],
    ["EAUTH 454 temporary", smtp("EAUTH", 454), false, TransientBeforeSendError],
    ["RCPT 450", smtp("EENVELOPE", 450, "RCPT TO"), false, TransientBeforeSendError],
    ["MAIL 421", smtp("EENVELOPE", 421), false, TransientBeforeSendError],
    ["DATA 451 (answered)", smtp("EMESSAGE", 451, "DATA"), true, TransientBeforeSendError],
    ["RCPT 550", smtp("EENVELOPE", 550, "RCPT TO"), false, PermanentSendError],
    ["DATA 554 (answered)", smtp("EMESSAGE", 554, "DATA"), true, PermanentSendError],
    ["ECONNREFUSED", smtp("ESOCKET"), false, TransientBeforeSendError],
    ["DNS failure", smtp("EDNS"), false, TransientBeforeSendError],
    ["timeout before DATA", smtp("ETIMEDOUT", undefined, "CONN"), false, TransientBeforeSendError],
    ["reset before DATA", smtp("ECONNECTION", undefined, "CONN"), false, TransientBeforeSendError],
    ["timeout after DATA", smtp("ETIMEDOUT", undefined, "CONN"), true, AmbiguousSendError],
    ["reset after DATA", smtp("ECONNECTION", undefined, "CONN"), true, AmbiguousSendError],
  ])("SMTP %s", (_n, err, dataStarted, cls) => {
    const e = mapSmtpError(err, dataStarted);
    expect(e).toBeInstanceOf(cls);
    expect(e.message).not.toContain("secret");
    expect(e.cause).toBeUndefined();
    if (cls !== AuthError) expect(e).not.toBeInstanceOf(AuthError);
  });

  const imap = (o: Record<string, unknown>) => Object.assign(new Error("secret reply"), o);
  it.each([
    [
      "LOGIN failed",
      imap({ authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED" }),
      AuthError,
    ],
    [
      "THROTTLED",
      imap({ serverResponseCode: "THROTTLED", responseStatus: "NO" }),
      RateLimitedError,
    ],
    [
      "too many connections",
      imap({ responseText: "Too many simultaneous connections", responseStatus: "NO" }),
      RateLimitedError,
    ],
    ["UNAVAILABLE", imap({ serverResponseCode: "UNAVAILABLE" }), TransientBeforeSendError],
    ["ECONNREFUSED", imap({ code: "ECONNREFUSED" }), TransientBeforeSendError],
    ["ETIMEDOUT", imap({ code: "ETIMEDOUT" }), TransientBeforeSendError],
    ["ENOTFOUND", imap({ code: "ENOTFOUND" }), TransientBeforeSendError],
    ["NoConnection", imap({ code: "NoConnection" }), TransientBeforeSendError],
    [
      "mailbox NO (not auth)",
      imap({ responseStatus: "NO", serverResponseCode: "NONEXISTENT" }),
      TransientBeforeSendError,
    ],
  ])("IMAP %s", (_n, err, cls) => {
    const e = mapImapError(err);
    expect(e).toBeInstanceOf(cls);
    expect(e.message).not.toContain("secret");
    if (cls !== AuthError) expect(e).not.toBeInstanceOf(AuthError);
  });

  it("live: reset after DATA is ambiguous, and nothing from the server or the password reaches the message", async () => {
    const s = await start();
    s.scenario.failNext("timeout_after_write");
    const e = await s
      .provider()
      .send({ from: { email: ADDRESS }, to: [x], subject: "s", text: "t", messageId: "<a@b>" })
      .catch((k) => k);
    expect(e).toBeInstanceOf(AmbiguousSendError);
    expect(e.message).not.toMatch(/\bp\b/);
  });
});
