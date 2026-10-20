import { createFixtureFetch, type CredentialStore, type OAuthCreds } from "../src";
import type { FailKind, Scenario } from "../src/contract/harness";

export const SCOPE =
  "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify";
const API = "https://gmail.googleapis.com/gmail/v1/users/me/";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const err = (status: number, reason: string, headers?: Record<string, string>) =>
  json(status, { error: { code: status, errors: [{ reason }] } }, headers);

type Msg = {
  id: string;
  threadId: string;
  labelIds: string[];
  raw: Buffer;
  seq: number;
  rfc: string;
};
type Rec = { id: number; added?: Msg; deleted?: Msg; labelAdded?: { msg: Msg; ids: string[] } };
type Req = { url: string; body?: string; headers: Record<string, string> };

export function memoryStore(init: Partial<OAuthCreds> = {}) {
  let c: OAuthCreds = {
    accessToken: "at-0",
    refreshToken: "rt-0",
    expiresAt: Date.now() + 3_600_000,
    scope: SCOPE,
    ...init,
  };
  return {
    get: async () => c,
    refresh: async (stale, doRefresh) =>
      c.accessToken !== stale.accessToken ? c : (c = await doRefresh(stale)),
    expire: () => void (c = { ...c, expiresAt: 0 }),
  } satisfies CredentialStore<OAuthCreds> & { expire(): void };
}

/** A stateful in-memory Gmail API v1 plus Google token endpoint. Shapes follow the public API reference (unverified live, P2-T07). */
export function createFakeGmail(address = "me@rn.test") {
  const msgs = new Map<string, Msg>();
  const history: Rec[] = [];
  let seq = 0;
  let hid = 1000;
  let floor = 0;
  let validToken = "at-0";
  let tokenN = 0;
  let revoked = false;
  let fail: FailKind | undefined;
  let tokenFail = false;
  const store = memoryStore();
  const stats = { sendCalls: 0, tokenCalls: 0 };

  const labels = (m: Msg) => ({ id: m.id, threadId: m.threadId, labelIds: m.labelIds });
  const add = (raw: Buffer, labelIds: string[], threadId?: string) => {
    seq++;
    const rfc = /^message-id:\s*(<[^>]+>)/im.exec(raw.toString("latin1"))![1]!;
    const m: Msg = { id: `g${seq}`, threadId: threadId ?? `t${seq}`, labelIds, raw, seq, rfc };
    msgs.set(m.id, m);
    history.push({ id: ++hid, added: m });
    return m;
  };
  const simple = (o: {
    from: string;
    to: string;
    subject: string;
    id: string;
    inReplyTo?: string;
  }) =>
    Buffer.from(
      `From: ${o.from}\r\nTo: ${o.to}\r\nSubject: ${o.subject}\r\nMessage-ID: ${o.id}\r\n` +
        (o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}\r\n` : "") +
        `Date: Mon, 01 Jan 2024 00:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nbody\r\n`,
    );
  const tick = () => new Promise((r) => setImmediate(r));
  const esc = (s: string) => s.replace(/[/.?]/g, "\\$&");

  /** Authed Gmail route: 401 unless the Bearer is the currently valid token. */
  const route = (
    method: string,
    path: string,
    h: (u: URL, req: Req) => Response | Promise<Response>,
  ) => ({
    method,
    url: new RegExp(`^${esc(API)}${path}(\\?.*)?$`),
    respond: async (req: Req) => {
      if (revoked || req.headers.authorization !== `Bearer ${validToken}`)
        return err(401, "authError");
      await tick(); // lets concurrent requests overlap so the recorded concurrency is real
      return h(new URL(req.url), req);
    },
  });
  const page = (all: Msg[], u: URL) => {
    const max = Number(u.searchParams.get("maxResults") ?? 100);
    const off = Number(u.searchParams.get("pageToken") ?? 0);
    const items = all.slice(off, off + max);
    return {
      ...(items.length ? { messages: items.map((m) => ({ id: m.id, threadId: m.threadId })) } : {}),
      ...(off + max < all.length ? { nextPageToken: String(off + max) } : {}),
    };
  };

  const fetch = createFixtureFetch([
    {
      method: "POST",
      url: "https://oauth2.googleapis.com/token",
      respond: async () => {
        stats.tokenCalls++;
        if (tokenFail) return ((tokenFail = false), json(503, { error: "backend_error" }));
        if (revoked) return json(400, { error: "invalid_grant" });
        validToken = `at-${++tokenN}`;
        return json(200, {
          access_token: validToken,
          expires_in: 3600,
          scope: SCOPE,
          token_type: "Bearer",
        });
      },
    },
    {
      method: "POST",
      url: "https://oauth2.googleapis.com/revoke",
      respond: async () => json(200, {}),
    },
    route("GET", "profile", () => json(200, { emailAddress: address, historyId: String(hid) })),
    route("POST", "messages/send", (_u, req) => {
      stats.sendCalls++;
      const f = fail;
      fail = undefined;
      if (f === "rate_limit") return err(429, "rateLimitExceeded", { "retry-after": "7" });
      if (f === "auth_revoked") return ((revoked = true), err(401, "authError"));
      if (f === "connect_refused")
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      if (f === "permanent_rejected") return err(400, "invalidArgument");
      const body = JSON.parse(req.body!) as { raw: string; threadId?: string };
      // Gmail delivers without Bcc; we drop it from the stored copy too (unverified against live Gmail)
      const raw = Buffer.from(
        Buffer.from(body.raw, "base64url")
          .toString("latin1")
          .replace(/^bcc:.*(\r\n[ \t].*)*\r\n/im, ""),
        "latin1",
      );
      const m = add(raw, ["SENT"], body.threadId);
      if (f === "api_5xx") return err(503, "backendError");
      if (f === "timeout_after_write")
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      return json(200, labels(m));
    }),
    route("GET", "history", (u) => {
      const start = Number(u.searchParams.get("startHistoryId"));
      if (start < floor) return err(404, "notFound");
      const recs = history.filter((r) => r.id > start);
      const max = Number(u.searchParams.get("maxResults") ?? 100);
      const off = Number(u.searchParams.get("pageToken") ?? 0);
      const items = recs.slice(off, off + max);
      return json(200, {
        ...(items.length
          ? {
              history: items.map((r) => ({
                id: String(r.id),
                ...(r.added ? { messagesAdded: [{ message: labels(r.added) }] } : {}),
                ...(r.labelAdded
                  ? {
                      labelsAdded: [
                        { message: labels(r.labelAdded.msg), labelIds: r.labelAdded.ids },
                      ],
                    }
                  : {}),
                ...(r.deleted ? { messagesDeleted: [{ message: labels(r.deleted) }] } : {}),
              })),
            }
          : {}),
        ...(off + max < recs.length ? { nextPageToken: String(off + max) } : {}),
        historyId: String(hid),
      });
    }),
    route("GET", "messages", (u) => {
      const q = u.searchParams.get("q") ?? "";
      const want = u.searchParams.getAll("labelIds");
      const rfc = /rfc822msgid:(\S+)/.exec(q)?.[1];
      let all = [...msgs.values()].reverse(); // newest first, like Gmail
      all = all.filter((m) => want.every((l) => m.labelIds.includes(l)));
      if (rfc) all = all.filter((m) => m.rfc === `<${rfc}>`);
      if (u.searchParams.get("includeSpamTrash") !== "true" && !/in:anywhere/.test(q))
        all = all.filter((m) => !m.labelIds.some((l) => l === "SPAM" || l === "TRASH"));
      if (/in:sent/.test(q)) all = all.filter((m) => m.labelIds.includes("SENT"));
      return json(200, page(all, u));
    }),
    route("GET", "messages/[^/?]+", (u) => {
      const m = msgs.get(u.pathname.split("/").pop()!);
      if (!m) return err(404, "notFound");
      return json(200, {
        ...labels(m),
        historyId: String(hid),
        ...(u.searchParams.get("format") === "raw" ? { raw: m.raw.toString("base64url") } : {}),
      });
    }),
  ]);

  const sentRaw = async () =>
    [...msgs.values()].filter((m) => m.labelIds.includes("SENT")).map((m) => m.raw);
  let n = 0;
  const scenario: Scenario = {
    async receiveInbound(m) {
      const id = `<in${++n}@x.test>`;
      add(
        simple({ from: m.from.email, to: address, subject: m.subject, id, inReplyTo: m.inReplyTo }),
        ["INBOX", "UNREAD"],
      );
      return { rfcMessageId: id };
    },
    async seedInbound(count) {
      for (let i = 0; i < count; i++)
        add(simple({ from: "x@rn.test", to: address, subject: `s${i}`, id: `<seed${i}@x.test>` }), [
          "INBOX",
        ]);
    },
    async receiveSpam() {
      const id = `<spam${++n}@x.test>`;
      add(simple({ from: "s@x.test", to: address, subject: "spam", id }), ["SPAM"]);
      return { rfcMessageId: id };
    },
    async saveDraft() {
      const id = `<draft${++n}@rn.test>`;
      add(simple({ from: address, to: "d@x.test", subject: "draft", id }), ["DRAFT"]);
      return { rfcMessageId: id };
    },
    async sendExternal(m) {
      add(simple({ from: address, to: "o@x.test", subject: m.subject, id: m.messageId }), ["SENT"]);
    },
    async deleteMessage(id) {
      const m = msgs.get(id)!;
      msgs.delete(id);
      history.push({ id: ++hid, deleted: m });
    },
    failNext(k) {
      if (k === "token_5xx") {
        tokenFail = true;
        store.expire(); // forces a refresh before the send
      } else fail = k;
    },
    async expireCursors() {
      floor = ++hid;
    },
    sentRaw,
  };
  const relabel = (id: string, plus: string[], minus: string[] = []) => {
    const m = msgs.get(id)!;
    m.labelIds = [...m.labelIds.filter((l) => !minus.includes(l)), ...plus];
    history.push({ id: ++hid, labelAdded: { msg: m, ids: plus } });
  };
  return {
    fetch,
    store,
    stats,
    add,
    relabel,
    msgs,
    simple,
    scenario,
    setFloor: (n: number) => (floor = n),
  };
}
