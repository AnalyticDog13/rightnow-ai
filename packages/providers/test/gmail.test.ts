import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  AmbiguousSendError,
  AuthError,
  GmailProvider,
  GoogleOAuth,
  PermanentSendError,
  RateLimitedError,
  TransientBeforeSendError,
  createFixtureFetch,
  type Route,
} from "../src";
import { createFakeGmail, memoryStore } from "./gmail-fake";

const fx = (n: string) =>
  JSON.parse(readFileSync(new URL(`../src/gmail/fixtures/${n}.json`, import.meta.url), "utf8"));
const errors = fx("errors");
const { pages } = fx("history-pages") as { pages: Record<string, unknown>[] };
const API = "https://gmail.googleapis.com/gmail/v1/users/me/";
const TOKEN = "https://oauth2.googleapis.com/token";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const raw = (id: string) =>
  Buffer.from(
    `From: x@x.test\r\nTo: me@rn.test\r\nSubject: s\r\nMessage-ID: <${id}@x.test>\r\n\r\nb\r\n`,
  ).toString("base64url");

function setup(routes: Route[], creds = {}) {
  const store = memoryStore(creds);
  const fetch = createFixtureFetch(routes);
  const p = new GmailProvider({
    address: "Me@rn.test",
    store,
    oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch }),
    fetch,
  });
  return { p, fetch, store };
}
const tokenOk = () => json(200, { access_token: "at-new", expires_in: 3600, scope: "s" });
const tokenRoute = (...sequence: Response[]): Route => ({ method: "POST", url: TOKEN, sequence });
const profile = (body: unknown = { emailAddress: "me@rn.test", historyId: "1" }): Route => ({
  method: "GET",
  url: API + "profile",
  respond: async () => json(200, body),
});
const mime = {
  from: { email: "me@rn.test" },
  to: [{ email: "to@rn.test" }],
  subject: "Hi",
  text: "t",
  messageId: "<c1@rn.test>",
};
const sendRoute = (r: Response | (() => Response)): Route => ({
  method: "POST",
  url: API + "messages/send",
  respond: async () => (typeof r === "function" ? r() : r.clone()),
});
const q = (url: string) => new URL(url).searchParams;

describe("send", () => {
  test("raw send with Bearer auth, threadId, Message-ID, Bcc and attachment", async () => {
    const { p, fetch } = setup([
      sendRoute(json(200, { id: "g1", threadId: "t-1", labelIds: ["SENT"] })),
    ]);
    const r = await p.send({
      ...mime,
      bcc: [{ email: "h@rn.test" }],
      threadId: "t-1",
      attachments: [
        { filename: "a.bin", contentType: "application/octet-stream", content: Buffer.from("zzz") },
      ],
    });
    expect(r).toEqual({
      rfcMessageId: "<c1@rn.test>",
      providerMessageId: "g1",
      providerThreadId: "t-1",
    });
    const c = fetch.calls[0]!;
    expect(`${c.method} ${c.url}`).toBe(`POST ${API}messages/send`);
    expect(c.headers.authorization).toBe("Bearer at-0");
    const body = JSON.parse(c.body!);
    expect(body.threadId).toBe("t-1");
    const decoded = Buffer.from(body.raw, "base64url").toString();
    expect(decoded).toContain("<c1@rn.test>");
    expect(decoded).toMatch(/^bcc: h@rn\.test/im);
    expect(decoded).toContain("filename=a.bin");
  });

  test("no threadId key when none is given", async () => {
    const { p, fetch } = setup([sendRoute(json(200, { id: "g1", threadId: "t" }))]);
    await p.send(mime);
    expect(JSON.parse(fetch.calls[0]!.body!)).not.toHaveProperty("threadId");
  });

  test("error mapping", async () => {
    const cases: [Response, (e: unknown) => void][] = [
      [json(403, errors.rateLimitExceeded), (e) => expect(e).toEqual(new RateLimitedError(60))],
      [
        json(403, errors.userRateLimitExceeded, { "retry-after": "9" }),
        (e) => expect(e).toEqual(new RateLimitedError(9)),
      ],
      [json(429, {}, { "retry-after": "7" }), (e) => expect(e).toEqual(new RateLimitedError(7))],
      [json(403, errors.dailyLimitExceeded), (e) => expect(e).toEqual(new RateLimitedError(3600))],
      [
        json(403, errors.insufficientPermissions),
        (e) => expect(e).toEqual(new AuthError("scope_revoked")),
      ],
      [
        json(400, errors.invalidArgument),
        (e) => {
          expect(e).toBeInstanceOf(PermanentSendError);
          expect((e as PermanentSendError).code).toBe("invalidArgument");
        },
      ],
      [json(500, {}), (e) => expect(e).toBeInstanceOf(AmbiguousSendError)],
    ];
    for (const [res, check] of cases) {
      const { p, fetch } = setup([sendRoute(res)]);
      check(await p.send(mime).catch((e) => e));
      expect(fetch.calls).toHaveLength(1);
    }
  });

  test("a rejection after the request was written is ambiguous, a refused connection is transient", async () => {
    const reject = (code: string) =>
      sendRoute(() => {
        throw new TypeError("fetch failed", { cause: { code } });
      });
    const a = setup([reject("ECONNRESET")]);
    expect(await a.p.send(mime).catch((e) => e)).toBeInstanceOf(AmbiguousSendError);
    const b = setup([reject("ENOTFOUND")]);
    expect(await b.p.send(mime).catch((e) => e)).toBeInstanceOf(TransientBeforeSendError);
  });

  test("a foreign From is rejected without a request", async () => {
    const { p, fetch } = setup([]);
    const e = await p.send({ ...mime, from: { email: "other@rn.test" } }).catch((x) => x);
    expect(e).toMatchObject({ code: "from_mismatch" });
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("lookup", () => {
  test("findSent searches all mail incl. trash by rfc822msgid, then fetches raw", async () => {
    const { p, fetch } = setup([
      {
        method: "GET",
        url: /messages\?/,
        respond: async () => json(200, { messages: [{ id: "g9", threadId: "t9" }] }),
      },
      {
        method: "GET",
        url: /messages\/g9\?/,
        respond: async () =>
          json(200, { id: "g9", threadId: "t9", labelIds: ["TRASH", "SENT"], raw: raw("c1") }),
      },
    ]);
    const m = await p.findSent("<c1@rn.test>");
    expect(m).toMatchObject({
      providerMessageId: "g9",
      providerThreadId: "t9",
      folder: "SENT",
      rfcMessageId: "<c1@x.test>",
    });
    const s = q(fetch.calls[0]!.url);
    expect(s.get("q")).toBe("rfc822msgid:c1@rn.test");
    expect(s.get("includeSpamTrash")).toBe("true");
    expect(q(fetch.calls[1]!.url).get("format")).toBe("raw");
  });

  test("findSent finds a trashed sent copy end to end", async () => {
    const g = createFakeGmail();
    const p = new GmailProvider({
      address: "me@rn.test",
      store: g.store,
      oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch: g.fetch }),
      fetch: g.fetch,
    });
    const r = await p.send(mime);
    g.msgs.get(r.providerMessageId!)!.labelIds = ["TRASH", "SENT"];
    expect((await p.findSent("<c1@rn.test>"))?.providerMessageId).toBe(r.providerMessageId);
    g.msgs.get(r.providerMessageId!)!.labelIds = ["TRASH"]; // SENT label gone: still ours by From
    expect((await p.findSent("<c1@rn.test>"))?.providerMessageId).toBe(r.providerMessageId);
  });

  test("a received message reusing our Message-ID is not our send", async () => {
    const { p } = setup([
      {
        method: "GET",
        url: /messages\?/,
        respond: async () => json(200, { messages: [{ id: "g1" }] }),
      },
      {
        method: "GET",
        url: /messages\/g1\?/,
        respond: async () => json(200, { id: "g1", labelIds: ["INBOX"], raw: raw("c1") }), // From x@x.test
      },
    ]);
    expect(await p.findSent("<c1@x.test>")).toBeNull();
  });

  test("findSent returns null on no hit", async () => {
    const { p } = setup([
      {
        method: "GET",
        url: /messages\?/,
        respond: async () => json(200, { resultSizeEstimate: 0 }),
      },
    ]);
    expect(await p.findSent("<c1@rn.test>")).toBeNull();
  });

  test("locate maps labelIds", async () => {
    const table = [
      [["SPAM"], "SPAM"],
      [["INBOX", "UNREAD"], "INBOX"],
      [["SENT"], "SENT"],
      [["DRAFT"], "OTHER"],
      [["TRASH"], "OTHER"],
    ] as const;
    for (const [labels, folder] of table) {
      const { p, fetch } = setup([
        {
          method: "GET",
          url: /messages\?/,
          respond: async () => json(200, { messages: [{ id: "g1" }] }),
        },
        {
          method: "GET",
          url: /messages\/g1\?/,
          respond: async () => json(200, { id: "g1", labelIds: labels }),
        },
      ]);
      expect(await p.locate("<c1@rn.test>")).toEqual({ folder, providerMessageId: "g1" });
      expect(q(fetch.calls[0]!.url).get("q")).toBe("rfc822msgid:c1@rn.test in:anywhere");
    }
  });
});

describe("sync", () => {
  const history = (seq: Response[]): Route[] => [
    { method: "GET", url: /history\?/, sequence: seq },
    {
      method: "GET",
      url: /messages\/m\d\?/,
      respond: async (r) => {
        const n = /messages\/(m\d)\?/.exec(r.url)![1]!;
        return n === "m5"
          ? json(404, errors.notFound)
          : json(200, {
              id: n,
              threadId: `t${n}`,
              labelIds: n === "m2" ? ["SENT"] : ["INBOX"],
              raw: raw(n),
            });
      },
    },
  ];

  test("pages: cursor carries pageToken, final cursor is the response historyId, each message once", async () => {
    const { p, fetch } = setup(history(pages.map((x) => json(200, x))));
    let cursor: Parameters<typeof p.listChangesSince>[0] = { kind: "gmail", historyId: "100" };
    const got: string[] = [];
    const removed: string[] = [];
    const cursors: unknown[] = [];
    for (;;) {
      const c = await p.listChangesSince(cursor, { limit: 2 });
      if (c.expired) throw new Error("expired");
      got.push(...c.messages.map((m) => m.providerMessageId));
      removed.push(...c.removed);
      cursors.push(c.cursor);
      cursor = c.cursor;
      if (!c.hasMore) break;
    }
    expect(got).toEqual(["m1", "m2", "m4", "m6"]); // m3 is SPAM; m5 is 404 and skipped
    expect(removed).toEqual(["m0"]);
    expect(cursors).toEqual([
      { kind: "gmail", historyId: "100", pageToken: "p2" },
      { kind: "gmail", historyId: "100", pageToken: "p3" },
      { kind: "gmail", historyId: "110" },
    ]);
    const h = fetch.calls.filter((c) => /history\?/.test(c.url));
    const u = q(h[0]!.url);
    expect(u.get("startHistoryId")).toBe("100");
    expect(u.getAll("historyTypes")).toEqual(["messageAdded", "messageDeleted", "labelAdded"]);
    expect(u.get("maxResults")).toBe("2");
    expect(q(h[1]!.url).get("pageToken")).toBe("p2");
    expect(q(h[1]!.url).get("startHistoryId")).toBe("100");
  });

  test("a reply delivered to SPAM and later moved to INBOX is reported with its current folder", async () => {
    const g = createFakeGmail();
    const p = new GmailProvider({
      address: "me@rn.test",
      store: g.store,
      oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch: g.fetch }),
      fetch: g.fetch,
    });
    const cursor = await p.currentCursor();
    const m = g.add(
      g.simple({ from: "x@rn.test", to: "me@rn.test", subject: "re", id: "<re@x.test>" }),
      ["SPAM"],
    );
    const c1 = await p.listChangesSince(cursor);
    if (c1.expired) throw new Error("expired");
    expect(c1.messages).toHaveLength(0);
    g.relabel(m.id, ["INBOX"], ["SPAM"]);
    const c2 = await p.listChangesSince(c1.cursor);
    if (c2.expired) throw new Error("expired");
    expect(c2.messages.map((x) => [x.providerMessageId, x.folder])).toEqual([[m.id, "INBOX"]]);
  });

  test("non-send 403 reasons: only true auth reasons are AuthError", async () => {
    const run = async (body: unknown) =>
      setup([{ method: "GET", url: API + "profile", respond: async () => json(403, body) }])
        .p.currentCursor()
        .catch((e) => e);
    const withReason = (reason?: string) => ({
      error: { code: 403, ...(reason ? { errors: [{ reason }] } : {}) },
    });
    for (const r of ["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "authError"])
      expect(await run(withReason(r)), r).toBeInstanceOf(AuthError);
    for (const r of [
      "rateLimitExceeded",
      "userRateLimitExceeded",
      "quotaExceeded",
      "concurrentLimitExceeded",
    ])
      expect(await run(withReason(r)), r).toEqual(new RateLimitedError(60));
    expect(await run(withReason("dailyLimitExceeded"))).toEqual(new RateLimitedError(3600));
    for (const r of ["domainPolicy", "accessNotConfigured", "forbidden", undefined]) {
      const e = await run(withReason(r));
      expect(e, String(r)).toBeInstanceOf(TransientBeforeSendError);
      expect(e).not.toBeInstanceOf(AuthError);
    }
  });

  test("other non-send 4xx are PermanentSendError", async () => {
    const p = setup([
      {
        method: "GET",
        url: API + "profile",
        respond: async () => json(400, errors.invalidArgument),
      },
    ]).p;
    expect(await p.currentCursor().catch((e) => e)).toBeInstanceOf(PermanentSendError);
  });

  test("history 404 is expired", async () => {
    const { p } = setup([
      { method: "GET", url: /history\?/, respond: async () => json(404, errors.notFound) },
    ]);
    expect(await p.listChangesSince({ kind: "gmail", historyId: "1" })).toEqual({ expired: true });
  });

  test("an invalid history pageToken (400) is expired, never a thrown error (I-7)", async () => {
    const { p } = setup([
      { method: "GET", url: /history\?/, respond: async () => json(400, errors.invalidArgument) },
    ]);
    expect(await p.listChangesSince({ kind: "gmail", historyId: "1", pageToken: "stale" })).toEqual(
      { expired: true },
    );
  });

  test("a listMessages page stops at the byte cap; its token resumes with nothing skipped or repeated (I-9)", async () => {
    const g = createFakeGmail();
    const p = new GmailProvider({
      address: "me@rn.test",
      store: g.store,
      oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch: g.fetch }),
      fetch: g.fetch,
      maxPageBytes: 1,
    });
    for (let i = 0; i < 20; i++)
      g.add(g.simple({ from: "x@rn.test", to: "me@rn.test", subject: `m${i}`, id: `<l${i}@x>` }), [
        "INBOX",
      ]);
    const seen: string[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const r = await p.listMessages({ since: new Date(0), folder: "INBOX", pageToken, limit: 12 });
      seen.push(...r.messages.map((m) => m.rfcMessageId!));
      pageToken = r.nextPageToken;
      pages++;
    } while (pageToken && pages < 10);
    expect(pages).toBeGreaterThan(2); // 12 + 8 ids, cut every 8 by the cap
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  test("a history page stops at the byte cap and resumes after the last message returned (I-9)", async () => {
    const g = createFakeGmail();
    const p = new GmailProvider({
      address: "me@rn.test",
      store: g.store,
      oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch: g.fetch }),
      fetch: g.fetch,
      maxPageBytes: 1,
    });
    let cursor = await p.currentCursor();
    for (let i = 0; i < 10; i++)
      g.add(g.simple({ from: "x@rn.test", to: "me@rn.test", subject: `m${i}`, id: `<m${i}@x>` }), [
        "INBOX",
      ]);
    const seen: string[] = [];
    const more: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await p.listChangesSince(cursor);
      if (c.expired) throw new Error("expired");
      seen.push(...c.messages.map((m) => m.rfcMessageId!));
      more.push(c.hasMore);
      cursor = c.cursor;
      if (!c.hasMore) break;
    }
    expect(more[0]).toBe(true);
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
    expect(more.at(-1)).toBe(false);
  });

  test("RemoteMessage.headers carries content-type (bounce detection reads multipart/report)", async () => {
    const g = createFakeGmail();
    const p = new GmailProvider({
      address: "me@rn.test",
      store: g.store,
      oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch: g.fetch }),
      fetch: g.fetch,
    });
    const cursor = await p.currentCursor();
    g.add(
      Buffer.from(
        "From: mailer-daemon@x.test\r\nTo: me@rn.test\r\nSubject: fail\r\nMessage-ID: <d@x>\r\n" +
          'MIME-Version: 1.0\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="B"\r\n\r\n' +
          "--B\r\nContent-Type: text/plain\r\n\r\nno\r\n--B--\r\n",
      ),
      ["INBOX"],
    );
    const c = await p.listChangesSince(cursor);
    if (c.expired) throw new Error("expired");
    expect(c.messages[0]!.headers["content-type"]?.[0]).toMatch(/^multipart\/report/);
  });

  test("currentCursor reads the profile historyId", async () => {
    const { p } = setup([profile({ emailAddress: "me@rn.test", historyId: "777" })]);
    expect(await p.currentCursor()).toEqual({ kind: "gmail", historyId: "777" });
  });

  test("503 with Retry-After during sync is a rate limit, plain 503 is transient", async () => {
    const at = (res: Response) =>
      setup([{ method: "GET", url: /history\?/, respond: async () => res.clone() }]);
    const c = { kind: "gmail", historyId: "1" } as const;
    expect(
      await at(json(503, {}, { "retry-after": "11" }))
        .p.listChangesSince(c)
        .catch((e) => e),
    ).toEqual(new RateLimitedError(11));
    expect(
      await at(json(503, {}))
        .p.listChangesSince(c)
        .catch((e) => e),
    ).toBeInstanceOf(TransientBeforeSendError);
  });

  test("listMessages: after:<epoch> and labelIds, at most 8 bodies in flight", async () => {
    const g = createFakeGmail();
    await g.scenario.seedInbound(30);
    const p = new GmailProvider({
      address: "me@rn.test",
      store: g.store,
      oauth: new GoogleOAuth({ clientId: "c", clientSecret: "s", fetch: g.fetch }),
      fetch: g.fetch,
    });
    const r = await p.listMessages({ since: new Date(5_000), folder: "INBOX", limit: 20 });
    expect(r.messages).toHaveLength(20);
    expect(r.nextPageToken).toBeTruthy();
    const list = q(g.fetch.calls.find((c) => /messages\?/.test(c.url))!.url);
    expect(list.get("q")).toBe("after:5");
    expect(list.getAll("labelIds")).toEqual(["INBOX"]);
    expect(list.get("maxResults")).toBe("20");
    const gets = g.fetch.calls.filter((c) => /messages\/g/.test(c.url));
    expect(gets).toHaveLength(20);
    expect(Math.max(...gets.map((c) => c.concurrency))).toBe(8);
  });
});

describe("tokens", () => {
  test("a plain error from the credential store before any request is transient, not an ambiguous send (m1)", async () => {
    const { p, fetch, store } = setup([sendRoute(json(200, {}))]);
    store.get = async () => {
      throw new Error("no credentials");
    };
    expect(await p.send(mime).catch((e) => e)).toBeInstanceOf(TransientBeforeSendError);
    expect(fetch.calls).toHaveLength(0);
  });

  test("an expiring token is refreshed once and stored; the refresh token is kept when Google omits it", async () => {
    const { p, fetch, store } = setup([tokenRoute(tokenOk()), profile()], {
      expiresAt: Date.now() + 10_000,
    });
    await p.currentCursor();
    expect(fetch.calls.filter((c) => c.url === TOKEN)).toHaveLength(1);
    expect(fetch.calls.at(-1)!.headers.authorization).toBe("Bearer at-new");
    expect(await store.get()).toMatchObject({ accessToken: "at-new", refreshToken: "rt-0" });
  });

  test("token endpoint 503 is transient and leaves credentials untouched", async () => {
    const { p, store } = setup([tokenRoute(json(503, { error: "backend_error" }))], {
      expiresAt: 0,
    });
    expect(await p.currentCursor().catch((e) => e)).toBeInstanceOf(TransientBeforeSendError);
    expect(await store.get()).toMatchObject({ accessToken: "at-0", expiresAt: 0 });
  });

  test("invalid_client / unauthorized_client is a transient app-config failure, not an AuthError", async () => {
    for (const error of ["invalid_client", "unauthorized_client"]) {
      const { p } = setup([tokenRoute(json(401, { error }))], { expiresAt: 0 });
      const e = await p.currentCursor().catch((x) => x);
      expect(e).toBeInstanceOf(TransientBeforeSendError);
      expect(e.message).toContain("Google app credentials invalid");
    }
  });

  test("invalid_grant is AuthError", async () => {
    const { p } = setup([tokenRoute(json(400, { error: "invalid_grant" }))], { expiresAt: 0 });
    expect(await p.currentCursor().catch((e) => e)).toEqual(new AuthError("invalid_grant"));
  });

  test("a 401 refreshes once and retries once; a second 401 is AuthError", async () => {
    const { p, fetch } = setup([
      tokenRoute(tokenOk()),
      {
        method: "GET",
        url: API + "profile",
        sequence: [
          json(401, errors.unauthorized),
          json(200, { emailAddress: "me@rn.test", historyId: "5" }),
        ],
      },
    ]);
    expect(await p.currentCursor()).toEqual({ kind: "gmail", historyId: "5" });
    expect(fetch.calls.map((c) => c.headers.authorization).filter(Boolean)).toEqual([
      "Bearer at-0",
      "Bearer at-new",
    ]);
    const twice = setup([
      tokenRoute(tokenOk()),
      { method: "GET", url: API + "profile", respond: async () => json(401, errors.unauthorized) },
    ]);
    expect(await twice.p.currentCursor().catch((e) => e)).toEqual(new AuthError("unauthorized"));
  });

  test("revoked before send: refresh invalid_grant, send route never called", async () => {
    const { p, fetch } = setup(
      [tokenRoute(json(400, { error: "invalid_grant" })), sendRoute(json(200, {}))],
      { expiresAt: 0 },
    );
    expect(await p.send(mime).catch((e) => e)).toEqual(new AuthError("invalid_grant"));
    expect(fetch.calls.filter((c) => /send/.test(c.url))).toHaveLength(0);
  });

  test("revoked mid-send: 401 then invalid_grant, send is posted exactly once", async () => {
    const { p, fetch } = setup([
      tokenRoute(json(400, { error: "invalid_grant" })),
      sendRoute(json(401, errors.unauthorized)),
    ]);
    expect(await p.send(mime).catch((e) => e)).toEqual(new AuthError("invalid_grant"));
    expect(fetch.calls.filter((c) => /send/.test(c.url))).toHaveLength(1);
  });

  test("no thrown error contains token or response text", async () => {
    const leak = (e: { message: string; cause?: unknown }) =>
      expect(e.message + String(e.cause) + JSON.stringify(e)).not.toMatch(/SUPERSECRET|at-0|rt-0/);
    const a = setup([
      sendRoute(
        json(400, { error: { message: "SUPERSECRET", errors: [{ reason: "invalidArgument" }] } }),
      ),
    ]);
    leak(await a.p.send(mime).catch((e) => e));
    const b = setup(
      [tokenRoute(json(400, { error: "invalid_grant", error_description: "SUPERSECRET" }))],
      { expiresAt: 0 },
    );
    leak(await b.p.send(mime).catch((e) => e));
  });
});

describe("diagnostics and revoke", () => {
  test("scopes are checked from the stored grant", async () => {
    const { p } = setup([profile()], { scope: "https://www.googleapis.com/auth/gmail.send" });
    const d = await p.diagnostics();
    expect(d.ok).toBe(false);
    expect(d.checks.find((c) => c.name === "scopes")).toMatchObject({
      ok: false,
      code: "scope_missing",
    });
  });

  test("an unreadable credential store is not scope_missing", async () => {
    const { p, store } = setup([profile()]);
    store.get = async () => Promise.reject(new Error("db down"));
    const d = await p.diagnostics();
    expect(d.ok).toBe(false);
    expect(d.checks).toEqual([
      expect.objectContaining({ name: "token", code: "credentials_unavailable" }),
    ]);
  });

  test("revoke posts the revoke endpoint; 400 invalid_token resolves", async () => {
    const { p, fetch } = setup([
      {
        method: "POST",
        url: "https://oauth2.googleapis.com/revoke",
        respond: async () => json(400, { error: "invalid_token" }),
      },
    ]);
    await expect(p.revoke()).resolves.toBeUndefined();
    expect(fetch.calls[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
  });
});

describe("push (watch)", () => {
  const watch = (r: Response): Route => ({
    method: "POST",
    url: API + "watch",
    respond: async () => r.clone(),
  });
  test("watch sends topicName, INBOX+SENT labels, INCLUDE; parses expiration (ms string) and historyId", async () => {
    const { p, fetch } = setup([
      watch(json(200, { historyId: "77", expiration: "1893456000000" })),
    ]);
    const r = await p.subscribe({ notificationUrl: "unused", topicName: "projects/p/topics/t" });
    expect(r).toEqual({ externalId: "77", expiresAt: new Date(1893456000000) });
    expect(JSON.parse(fetch.calls[0]!.body!)).toEqual({
      topicName: "projects/p/topics/t",
      labelIds: ["INBOX", "SENT"],
      labelFilterBehavior: "INCLUDE",
    });
  });
  test("renew is the same call; unsubscribe posts stop", async () => {
    const { p, fetch } = setup([
      watch(json(200, { historyId: "78", expiration: "1893456000000" })),
      { method: "POST", url: API + "stop", respond: async () => json(200, {}) },
    ]);
    expect((await p.renew("77", { topicName: "t" })).expiresAt).toEqual(new Date(1893456000000));
    await p.unsubscribe();
    expect(fetch.calls.map((c) => c.url)).toEqual([API + "watch", API + "stop"]);
  });
  test("403 PERMISSION_DENIED is TransientBeforeSendError pubsub_permission, not AuthError", async () => {
    const { p } = setup([
      watch(
        json(403, { error: { status: "PERMISSION_DENIED", errors: [{ reason: "forbidden" }] } }),
      ),
    ]);
    const e = await p.subscribe({ notificationUrl: "u", topicName: "t" }).catch((x) => x);
    expect(e).toBeInstanceOf(TransientBeforeSendError);
    expect(e).not.toBeInstanceOf(AuthError);
    expect(e.detail).toBe("pubsub_permission");
  });
  test("subscribe without a topic fails before any request", async () => {
    const { p, fetch } = setup([]);
    await expect(p.subscribe({ notificationUrl: "u" })).rejects.toBeInstanceOf(
      TransientBeforeSendError,
    );
    expect(fetch.calls).toHaveLength(0);
  });
});
