import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  AdminConsentRequiredError,
  AmbiguousSendError,
  AuthError,
  GraphProvider,
  MicrosoftOAuth,
  PermanentSendError,
  RateLimitedError,
  TransientBeforeSendError,
  createFixtureFetch,
  type Route,
  type SyncCursor,
} from "../src";
import { memoryStore } from "./gmail-fake";
import { G, SCOPE, TOKEN_URL, createFakeGraph } from "./graph-fake";

const fx = (n: string) =>
  JSON.parse(readFileSync(new URL(`../src/graph/fixtures/${n}.json`, import.meta.url), "utf8"));
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const mime = {
  from: { email: "me@rn.test" },
  to: [{ email: "to@rn.test" }],
  subject: "Hi",
  text: "t",
  messageId: "<c1@rn.test>",
};
const oauth = (fetch: typeof globalThis.fetch, tenant = "common") =>
  new MicrosoftOAuth({ clientId: "cid", clientSecret: "sec", tenant, fetch });
const make = (fetch: typeof globalThis.fetch, store = memoryStore({ scope: SCOPE })) =>
  new GraphProvider({ address: "Me@rn.test", store, oauth: oauth(fetch), fetch });
const fake = () => {
  const g = createFakeGraph();
  return { g, p: make(g.fetch, g.store) };
};
const changes = async (p: GraphProvider, c: SyncCursor, limit?: number) => {
  const r = await p.listChangesSince(c, { limit });
  if (r.expired) throw new Error("expired");
  return r;
};
const inboxMsg = (g: ReturnType<typeof createFakeGraph>, id: string) =>
  g.add(g.simple({ from: "x@rn.test", to: "me@rn.test", subject: "s", id }), "inbox");

describe("send", () => {
  test("draft first, then send, same id; text/plain base64 MIME with Bcc; result shape", async () => {
    const { g, p } = fake();
    const r = await p.send({ ...mime, bcc: [{ email: "h@rn.test" }] });
    const calls = g.fetch.calls.filter((c) => !c.url.includes("login."));
    expect(calls.map((c) => `${c.method} ${c.url.replace(G, "")}`)).toEqual([
      "POST /me/messages",
      `POST /me/messages/${r.providerMessageId}/send`,
    ]);
    expect(calls[0]!.headers["content-type"]).toBe("text/plain");
    const body = Buffer.from(calls[0]!.body!, "base64").toString();
    expect(body).toMatch(/^bcc:.*h@rn\.test/im);
    expect(body).toContain("Message-ID: <c1@rn.test>");
    expect(r).toEqual({
      rfcMessageId: "<c1@rn.test>",
      providerMessageId: expect.stringMatching(/^AAMk/),
      providerThreadId: expect.stringMatching(/^conv/),
    });
  });

  test("every recorded call carries Prefer: IdType=ImmutableId", async () => {
    const { g, p } = fake();
    await p.send(mime);
    await g.scenario.receiveInbound({ from: { email: "x@rn.test" }, subject: "s", text: "t" });
    await p.findSent("<c1@rn.test>");
    await p.locate("<c1@rn.test>");
    await changes(p, await p.currentCursor());
    await p.listMessages({ since: new Date(0), folder: "INBOX" });
    await p.diagnostics();
    const graph = g.fetch.calls.filter((c) => c.url.startsWith(G));
    expect(graph.length).toBeGreaterThan(8);
    for (const c of graph) expect(c.headers.prefer).toContain('IdType="ImmutableId"');
  });

  test("findSent returns the providerMessageId send() returned", async () => {
    const { p } = fake();
    const r = await p.send(mime);
    const hint = { providerMessageId: r.providerMessageId };
    expect((await p.findSent("<c1@rn.test>", hint))?.providerMessageId).toBe(r.providerMessageId);
    expect((await p.findSent("<c1@rn.test>"))?.providerMessageId).toBe(r.providerMessageId);
  });

  test("draft 5xx -> TransientBeforeSendError and the send route is never called", async () => {
    const { g, p } = fake();
    g.failWith("draft_5xx");
    await expect(p.send(mime)).rejects.toBeInstanceOf(TransientBeforeSendError);
    expect(g.stats.sendCalls).toBe(0);
  });

  test("draft 429: Retry-After 7 honored, absent header -> 60", async () => {
    const { g, p } = fake();
    g.failWith("rate_limit");
    expect(await p.send(mime).catch((e) => e)).toMatchObject({ retryAfterSec: 7 });
    g.failWith("draft_429_no_header");
    const e = await p.send(mime).catch((x) => x);
    expect(e).toBeInstanceOf(RateLimitedError);
    expect(e.retryAfterSec).toBe(60);
    expect(g.stats.sendCalls).toBe(0);
  });

  test("send 429 Retry-After 120 -> RateLimitedError(120)", async () => {
    const { g, p } = fake();
    g.failWith("rate_limit_send");
    expect(await p.send(mime).catch((e) => e)).toMatchObject({
      name: "RateLimitedError",
      retryAfterSec: 120,
    });
  });

  test("send 429: the error carries the draft id, no orphan remains, and a retry sends exactly one message", async () => {
    const { g, p } = fake();
    g.failWith("rate_limit_send");
    const e = await p.send(mime).catch((x) => x);
    expect(e).toBeInstanceOf(RateLimitedError);
    expect(e.providerMessageId).toBeTruthy();
    expect(g.msgs.size).toBe(0);
    const r = await p.send(mime);
    expect(g.msgs.size).toBe(1);
    expect([...g.msgs.values()].filter((m) => !m.isDraft)).toHaveLength(1);
    expect((await p.findSent("<c1@rn.test>"))?.providerMessageId).toBe(r.providerMessageId);
  });

  test("ambiguous send 5xx: the error carries the draft id and findSent with it finds the sent item even if Graph rewrote the Message-ID", async () => {
    const { g, p } = fake();
    g.rewriteIds();
    g.failWith("api_5xx");
    const e = await p.send(mime).catch((x) => x);
    expect(e).toBeInstanceOf(AmbiguousSendError);
    expect(e.providerMessageId).toBeTruthy();
    expect(await p.findSent("<c1@rn.test>")).toBeNull();
    const m = await p.findSent("<c1@rn.test>", { providerMessageId: e.providerMessageId });
    expect(m?.providerMessageId).toBe(e.providerMessageId);
  });

  test("send 5xx -> AmbiguousSendError; the draft is not deleted", async () => {
    const { g, p } = fake();
    g.failWith("api_5xx");
    await expect(p.send(mime)).rejects.toBeInstanceOf(AmbiguousSendError);
    expect(g.fetch.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  test("send 400 -> PermanentSendError and the orphan draft is deleted", async () => {
    const { g, p } = fake();
    g.failWith("permanent_rejected");
    await expect(p.send(mime)).rejects.toBeInstanceOf(PermanentSendError);
    expect(g.fetch.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(g.msgs.size).toBe(0);
  });

  test("deleteDraft deletes a draft", async () => {
    const { g, p } = fake();
    const d = await g.scenario.saveDraft();
    const id = [...g.msgs.values()].find((m) => m.isDraft)!.id;
    expect(d.rfcMessageId).toContain("draft");
    await p.deleteDraft(id);
    expect(g.msgs.has(id)).toBe(false);
  });

  test("deleteDraft never deletes a sent message", async () => {
    const { g, p } = fake();
    const r = await p.send(mime);
    await p.deleteDraft(r.providerMessageId!);
    expect(g.msgs.has(r.providerMessageId!)).toBe(true);
    expect(g.fetch.calls.some((c) => c.method === "DELETE")).toBe(false);
    await expect(p.deleteDraft("AAMk-gone")).resolves.toBeUndefined(); // already gone is fine
  });

  test("rejects a foreign From without any request", async () => {
    const { g, p } = fake();
    await expect(p.send({ ...mime, from: { email: "o@rn.test" } })).rejects.toMatchObject({
      code: "from_mismatch",
    });
    expect(g.fetch.calls).toHaveLength(0);
  });
});

describe("findSent and locate", () => {
  test("falls back to the hint when Graph rewrote the Message-ID", async () => {
    const { g, p } = fake();
    g.rewriteIds();
    const r = await p.send(mime);
    expect(await p.findSent("<c1@rn.test>")).toBeNull();
    const m = await p.findSent("<c1@rn.test>", { providerMessageId: r.providerMessageId });
    expect(m?.providerMessageId).toBe(r.providerMessageId);
    expect(m?.rfcMessageId).toMatch(/^<rw/);
  });

  test("the hint is refused when that message is not in Sent Items", async () => {
    const { g, p } = fake();
    const inbound = inboxMsg(g, "<z@x>");
    expect(await p.findSent("<nope@rn.test>", { providerMessageId: inbound.id })).toBeNull();
  });

  test("finds our message after the user moved the Sent copy to Deleted Items or Junk", async () => {
    const { g, p } = fake();
    const r = await p.send(mime);
    for (const to of ["deleteditems", "junkemail"] as const) {
      g.move(r.providerMessageId!, to);
      expect((await p.findSent("<c1@rn.test>"))?.providerMessageId).toBe(r.providerMessageId);
    }
  });

  test("a received message with the same Message-ID is not our send", async () => {
    const { g, p } = fake();
    inboxMsg(g, "<c1@rn.test>");
    expect(await p.findSent("<c1@rn.test>")).toBeNull();
  });

  test("a draft with that id is not sent yet", async () => {
    const { g, p } = fake();
    const d = await g.scenario.saveDraft();
    expect(await p.findSent(d.rfcMessageId)).toBeNull();
  });

  test("an id with a quote is escaped in the filter", async () => {
    const { g, p } = fake();
    await p.findSent("<o'brien@rn.test>");
    const call = g.fetch.calls.find((c) => c.url.includes("internetMessageId"))!;
    const filter = new URL(call.url).searchParams.get("$filter");
    expect(filter).toBe("internetMessageId eq '<o''brien@rn.test>'");
  });

  test("locate reports Junk and Inbox", async () => {
    const { g, p } = fake();
    const spam = await g.scenario.receiveSpam();
    expect((await p.locate(spam.rfcMessageId))?.folder).toBe("SPAM");
    expect(await p.locate("<x@none>")).toBeNull();
  });
});

describe("sync", () => {
  test("a reply moved Junk -> Inbox surfaces in listChangesSince", async () => {
    const { g, p } = fake();
    const spam = await g.scenario.receiveSpam();
    const cursor = await p.currentCursor();
    const id = [...g.msgs.values()].find((m) => m.folder === "junkemail")!.id;
    g.move(id, "inbox");
    const c = await changes(p, cursor);
    expect(c.messages.map((m) => m.rfcMessageId)).toEqual([spam.rfcMessageId]);
    expect(c.messages[0]).toMatchObject({ folder: "INBOX", providerMessageId: id });
  });

  test("a message moved out of the Inbox is not reported as removed; a deleted one is", async () => {
    const { g, p } = fake();
    const a = inboxMsg(g, "<a@x>");
    const b = inboxMsg(g, "<b@x>");
    const cursor = await p.currentCursor();
    g.move(a.id, "deleteditems");
    g.remove(b.id);
    expect((await changes(p, cursor)).removed).toEqual([b.id]);
  });

  test("3-page delta with limit 2 returns each message once and stores the nextLink between pages", async () => {
    const { g, p } = fake();
    let cursor = await p.currentCursor();
    for (let i = 0; i < 5; i++)
      await g.scenario.receiveInbound({
        from: { email: "x@rn.test" },
        subject: `m${i}`,
        text: "t",
      });
    const seen: string[] = [];
    const links: string[] = [];
    for (const want of [true, true, false]) {
      const c = await changes(p, cursor, 2);
      expect(c.hasMore).toBe(want);
      seen.push(...c.messages.map((m) => m.providerMessageId));
      cursor = c.cursor;
      if (cursor.kind === "graph") links.push(cursor.inbox);
    }
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
    expect(links[0]).toContain("skiptoken");
    expect(links[1]).toContain("skiptoken");
    expect(links[2]).toContain("deltatoken");
  });

  test("$value fetches run at most 4 at a time", async () => {
    const { g, p } = fake();
    const cursor = await p.currentCursor();
    for (let i = 0; i < 20; i++)
      await g.scenario.receiveInbound({
        from: { email: "x@rn.test" },
        subject: `m${i}`,
        text: "t",
      });
    const c = await changes(p, cursor, 20);
    expect(c.messages).toHaveLength(20);
    const peak = Math.max(
      ...g.fetch.calls.filter((x) => x.url.endsWith("$value")).map((x) => x.concurrency),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  test("currentCursor asks delta for the last 5 minutes only", async () => {
    const g = createFakeGraph();
    const now = new Date("2026-01-01T12:00:00Z");
    const p = new GraphProvider({
      address: "me@rn.test",
      store: g.store,
      oauth: oauth(g.fetch),
      fetch: g.fetch,
      clock: { now: () => now },
    });
    await p.currentCursor();
    const u = new URL(g.fetch.calls.find((c) => c.url.includes("/inbox/messages/delta"))!.url);
    expect(u.searchParams.get("$filter")).toBe("receivedDateTime ge 2026-01-01T11:55:00.000Z");
  });

  test("delta fixture shapes: nextLink pending, then deltaLink; only deleted ids are removed", async () => {
    const { pages } = fx("delta-pages") as { pages: Record<string, string>[] };
    const raw = Buffer.from(
      "From: x@x.test\r\nTo: me@rn.test\r\nSubject: s\r\nMessage-ID: <a@x>\r\n\r\nb\r\n",
    );
    const fetch = createFixtureFetch([
      { method: "GET", url: /\/inbox\/messages\/delta/, sequence: pages.map((x) => json(200, x)) },
      {
        method: "GET",
        url: /\/sentitems\/messages\/delta/,
        respond: async () =>
          json(200, {
            value: [],
            "@odata.deltaLink": `${G}/me/mailFolders/sentitems/messages/delta?$deltatoken=s`,
          }),
      },
      { method: "GET", url: /\$value$/, respond: async () => new Response(new Uint8Array(raw)) },
    ]);
    const p = make(fetch);
    const start: SyncCursor = {
      kind: "graph",
      inbox: `${G}/me/mailFolders/inbox/messages/delta?$deltatoken=d0`,
      sent: `${G}/me/mailFolders/sentitems/messages/delta?$deltatoken=s0`,
    };
    const c1 = await changes(p, start, 10);
    expect(c1).toMatchObject({ hasMore: true, removed: ["AAMkA2"] });
    expect(c1.messages.map((m) => m.providerMessageId)).toEqual(["AAMkA1"]);
    expect(c1.cursor).toMatchObject({ kind: "graph", inbox: pages[0]!["@odata.nextLink"] });
    const c2 = await changes(p, c1.cursor, 10);
    expect(c2.hasMore).toBe(false);
    expect(c2.removed).toEqual([]);
    expect(c2.cursor).toMatchObject({ inbox: pages[1]!["@odata.deltaLink"] });
  });

  test("HTTP 410 on delta -> expired", async () => {
    const fetch = createFixtureFetch([
      {
        method: "GET",
        url: /delta/,
        respond: async () => json(410, { error: { code: "SyncStateNotFound" } }),
      },
    ]);
    const r = await make(fetch).listChangesSince({
      kind: "graph",
      inbox: `${G}/me/mailFolders/inbox/messages/delta?$deltatoken=1`,
      sent: `${G}/me/mailFolders/sentitems/messages/delta?$deltatoken=1`,
    });
    expect(r).toEqual({ expired: true });
  });

  test("a cursor or page token pointing off graph.microsoft.com is refused before any request", async () => {
    const { g, p } = fake();
    const evil = "https://evil.test/v1.0/me/messages";
    await expect(p.listChangesSince({ kind: "graph", inbox: evil, sent: evil })).rejects.toThrow();
    await expect(
      p.listMessages({ since: new Date(0), folder: "INBOX", pageToken: evil }),
    ).rejects.toThrow();
    expect(g.fetch.calls).toHaveLength(0);
  });

  test("delta 503 + Retry-After 30 -> RateLimitedError(30)", async () => {
    const { g, p } = fake();
    const cursor = await p.currentCursor();
    g.failWith("delta_503");
    expect(await p.listChangesSince(cursor).catch((e) => e)).toMatchObject({
      name: "RateLimitedError",
      retryAfterSec: 30,
    });
  });
});

describe("error mapping table", () => {
  const { cases } = fx("errors") as {
    cases: {
      status: number;
      code: string;
      retryAfter?: string;
      send?: boolean;
      expect: string;
      sec?: number;
    }[];
  };
  test.each(cases)("$status $code send=$send -> $expect", async (c) => {
    const reply = () =>
      json(
        c.status,
        { error: { code: c.code, message: "SECRET-BODY" } },
        c.retryAfter ? { "retry-after": c.retryAfter } : {},
      );
    const routes: Route[] = [
      {
        method: "POST",
        url: `${G}/me/messages`,
        respond: async () => (c.send ? json(201, { id: "d1", conversationId: "c" }) : reply()),
      },
      { method: "POST", url: `${G}/me/messages/d1/send`, respond: async () => reply() },
      {
        method: "GET",
        url: /\/me\/messages\/d1/,
        respond: async () => json(200, { id: "d1", isDraft: true }),
      },
      {
        method: "DELETE",
        url: `${G}/me/messages/d1`,
        respond: async () => new Response(null, { status: 204 }),
      },
    ];
    const e = await make(createFixtureFetch(routes))
      .send(mime)
      .catch((x) => x);
    expect(e.name).toBe(c.expect);
    if (c.sec) expect(e.retryAfterSec).toBe(c.sec);
    expect(JSON.stringify(e) + e.message + String(e.cause)).not.toContain("SECRET-BODY");
    expect(e).not.toBeInstanceOf(AuthError);
  });

  test("403 on a read is never an AuthError", async () => {
    const fetch = createFixtureFetch([
      {
        method: "GET",
        url: /\/me\?/,
        respond: async () => json(403, { error: { code: "ErrorAccessDenied" } }),
      },
    ]);
    const d = await make(fetch).diagnostics();
    expect(d.checks.find((x) => x.name === "token")?.ok).toBe(true);
    expect(d.checks.find((x) => x.name === "api")).toMatchObject({ ok: false });
  });

  test("a 401 refreshes once and retries; a second 401 is AuthError", async () => {
    let n = 0;
    const fetch = createFixtureFetch([
      {
        method: "POST",
        url: TOKEN_URL,
        respond: async () =>
          json(200, {
            access_token: `at-n${++n}`,
            refresh_token: "rt-n",
            expires_in: 3600,
            scope: SCOPE,
          }),
      },
      {
        method: "POST",
        url: `${G}/me/messages`,
        respond: async () => json(401, { error: { code: "InvalidAuthenticationToken" } }),
      },
    ]);
    const e = await make(fetch)
      .send(mime)
      .catch((x) => x);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.reason).toBe("unauthorized");
    expect(n).toBe(1);
  });

  test("network failure on the draft call is transient; after the send is written it is ambiguous", async () => {
    const mk = (failAt: "draft" | "send") =>
      createFixtureFetch([
        {
          method: "POST",
          url: `${G}/me/messages`,
          respond: async () => {
            if (failAt === "draft") throw new TypeError("fetch failed");
            return json(201, { id: "d1", conversationId: "c" });
          },
        },
        {
          method: "POST",
          url: `${G}/me/messages/d1/send`,
          respond: async () => {
            throw new TypeError("reset");
          },
        },
      ]);
    await expect(make(mk("draft")).send(mime)).rejects.toBeInstanceOf(TransientBeforeSendError);
    await expect(make(mk("send")).send(mime)).rejects.toBeInstanceOf(AmbiguousSendError);
  });
});

describe("tokens", () => {
  test("token endpoint 503 -> TransientBeforeSendError, never AuthError", async () => {
    const g = createFakeGraph();
    g.scenario.failNext("token_5xx");
    const e = await make(g.fetch, g.store)
      .currentCursor()
      .catch((x) => x);
    expect(e).toBeInstanceOf(TransientBeforeSendError);
  });

  const tokenFetch = (status: number, body: unknown, headers = {}) =>
    createFixtureFetch([
      { method: "POST", url: TOKEN_URL, respond: async () => json(status, body, headers) },
    ]);
  const creds = { accessToken: "a", refreshToken: "rt-old", expiresAt: 0, scope: SCOPE };

  test("refresh error codes", async () => {
    const run = (status: number, body: unknown) =>
      oauth(tokenFetch(status, body))
        .refresh(creds)
        .catch((e) => e);
    expect(await run(400, { error: "interaction_required" })).toMatchObject({
      name: "AuthError",
      reason: "invalid_grant",
    });
    expect(await run(400, { error: "invalid_grant" })).toMatchObject({
      name: "AuthError",
      reason: "invalid_grant",
    });
    for (const error of ["invalid_client", "unauthorized_client"]) {
      const e = await run(400, { error });
      expect(e).toBeInstanceOf(TransientBeforeSendError); // an app-secret problem must not flag mailboxes
      expect(e.message).toContain("Microsoft app credentials invalid");
    }
    expect(
      await run(400, { error: "invalid_grant", error_description: "AADSTS65001: consent" }),
    ).toMatchObject({ name: "AuthError", reason: "scope_revoked" });
    expect(await run(500, { error: "server_error" })).toBeInstanceOf(TransientBeforeSendError);
    expect(await run(400, { error: "temporarily_unavailable" })).toBeInstanceOf(
      TransientBeforeSendError,
    );
    expect(await run(400, { error: "invalid_request" })).toBeInstanceOf(TransientBeforeSendError);
    const net = oauth(
      createFixtureFetch([
        {
          method: "POST",
          url: TOKEN_URL,
          respond: async () => {
            throw new TypeError("x");
          },
        },
      ]),
    );
    expect(await net.refresh(creds).catch((e) => e)).toBeInstanceOf(TransientBeforeSendError);
    expect(
      await oauth(tokenFetch(429, {}, { "retry-after": "9" }))
        .refresh(creds)
        .catch((e) => e),
    ).toMatchObject({ retryAfterSec: 9 });
  });

  test("refresh sends scope, keeps the old refresh token when none is returned, replaces it when present", async () => {
    const f = tokenFetch(200, { access_token: "a2", expires_in: 100, scope: SCOPE });
    const r = await oauth(f).refresh(creds);
    expect(r.refreshToken).toBe("rt-old");
    const b = new URLSearchParams(f.calls[0]!.body);
    expect(b.get("scope")).toBe("offline_access User.Read Mail.Send Mail.ReadWrite");
    expect(b.get("grant_type")).toBe("refresh_token");
    const r2 = await oauth(
      tokenFetch(200, { access_token: "a2", refresh_token: "rt-new", expires_in: 100 }),
    ).refresh(creds);
    expect(r2.refreshToken).toBe("rt-new");
  });

  test("exchange: AADSTS65001 and admin-approval errors -> AdminConsentRequiredError", async () => {
    const x = (b: unknown) =>
      oauth(tokenFetch(400, b))
        .exchange({ code: "c", codeVerifier: "v", redirectUri: "http://x/cb" })
        .catch((e) => e);
    expect(
      await x({
        error: "invalid_grant",
        error_description: "AADSTS65001: The user or administrator has not consented",
        error_codes: [65001],
      }),
    ).toBeInstanceOf(AdminConsentRequiredError);
    expect(
      await x({ error: "access_denied", error_description: "AADSTS90094: admin consent required" }),
    ).toBeInstanceOf(AdminConsentRequiredError);
    expect(await x({ error: "invalid_request" })).toBeInstanceOf(AuthError);
  });

  test("exchange: email = mail ?? userPrincipalName, lowercased, from the /me call", async () => {
    const mk = (me: unknown) =>
      createFixtureFetch([
        {
          method: "POST",
          url: TOKEN_URL,
          respond: async () =>
            json(200, { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: SCOPE }),
        },
        {
          method: "GET",
          url: /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\?/,
          respond: async () => json(200, me),
        },
      ]);
    const p = { code: "c", codeVerifier: "v", redirectUri: "http://x/cb" };
    const a = await oauth(
      mk({
        mail: "Ann@Corp.com",
        userPrincipalName: "ann@corp.onmicrosoft.com",
        displayName: "Ann",
      }),
    ).exchange(p);
    expect(a).toMatchObject({
      email: "ann@corp.com",
      displayName: "Ann",
      creds: { refreshToken: "rt", scope: SCOPE },
    });
    const b = await oauth(mk({ mail: null, userPrincipalName: "Bob@Live.com" })).exchange(p);
    expect(b.email).toBe("bob@live.com");
    const guest = { userPrincipalName: "bob_live.com#EXT#@corp.onmicrosoft.com" };
    // a guest's mail wins; with no mail the connect fails rather than storing the #EXT# name
    expect((await oauth(mk({ ...guest, mail: "bob@live.com" })).exchange(p)).email).toBe(
      "bob@live.com",
    );
    expect(
      await oauth(mk({ ...guest, mail: null }))
        .exchange(p)
        .catch((e) => e),
    ).toBeInstanceOf(AuthError);
  });

  test("authUrl uses the tenant authority, PKCE and the four scopes; the token endpoint follows the tenant", async () => {
    for (const tenant of ["common", "organizations"]) {
      const o = oauth(tokenFetch(200, {}), tenant);
      const u = new URL(
        o.authUrl({
          state: "st",
          codeChallenge: "ch",
          redirectUri: "http://x/cb",
          loginHint: "a@b.test",
        }),
      );
      expect(`${u.origin}${u.pathname}`).toBe(
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      );
      expect(u.searchParams.get("scope")).toBe("offline_access User.Read Mail.Send Mail.ReadWrite");
      expect(u.searchParams.get("code_challenge_method")).toBe("S256");
      expect(u.searchParams.get("login_hint")).toBe("a@b.test");
    }
    const f = createFixtureFetch([
      {
        method: "POST",
        url: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
        respond: async () => json(200, { access_token: "a", expires_in: 1 }),
      },
    ]);
    await oauth(f, "organizations").refresh(creds);
    expect(f.calls).toHaveLength(1);
  });

  test("revoke() records zero calls", async () => {
    const g = createFakeGraph();
    await make(g.fetch, g.store).revoke();
    expect(g.fetch.calls).toHaveLength(0);
  });
});

describe("diagnostics", () => {
  test("an invalid client secret is an api failure, not an auth failure", async () => {
    const f = createFixtureFetch([
      {
        method: "POST",
        url: TOKEN_URL,
        respond: async () => json(400, { error: "invalid_client" }),
      },
    ]);
    const p = make(f, memoryStore({ scope: SCOPE, expiresAt: 0 }));
    const d = await p.diagnostics();
    expect(d.ok).toBe(false);
    expect(d.checks.find((c) => c.name === "token")?.ok).toBe(true);
    expect(d.checks.find((c) => c.name === "api")).toMatchObject({ ok: false });
  });

  test("an unreadable credential store is not scope_missing", async () => {
    const store = {
      ...memoryStore({ scope: SCOPE }),
      get: async () => Promise.reject(new Error("db down")),
    };
    const d = await make(createFakeGraph().fetch, store as never).diagnostics();
    expect(d.ok).toBe(false);
    expect(d.checks).toEqual([
      expect.objectContaining({ name: "token", code: "credentials_unavailable" }),
    ]);
  });

  test("missing Mail.ReadWrite is reported; normalized URL scopes pass", async () => {
    const mk = (scope: string) => make(createFakeGraph().fetch, memoryStore({ scope }));
    const bad = await mk("Mail.Send User.Read").diagnostics();
    expect(bad.ok).toBe(false);
    expect(bad.checks.find((c) => c.name === "scopes")).toMatchObject({
      ok: false,
      code: "scope_missing",
    });
    const good = await mk(
      "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite",
    ).diagnostics();
    expect(good.ok).toBe(true);
  });
});
