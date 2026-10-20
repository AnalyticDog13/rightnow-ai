import { createFixtureFetch } from "../src";
import type { Scenario } from "../src/contract/harness";
import { memoryStore } from "./gmail-fake";

export const SCOPE = "Mail.Send Mail.ReadWrite User.Read profile openid email";
export const G = "https://graph.microsoft.com/v1.0";
export const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const err = (status: number, code: string, headers?: Record<string, string>) =>
  json(status, { error: { code, message: "m" } }, headers);

type FolderName = "inbox" | "sentitems" | "junkemail" | "drafts" | "deleteditems";
type Msg = {
  id: string;
  folder: FolderName;
  raw: Buffer;
  isDraft: boolean;
  seq: number;
  from: string;
  conv: string;
};
type Ev = { n: number; folder: FolderName; id: string; removed?: "deleted" | "changed" };

const header = (raw: Buffer, name: string) =>
  new RegExp(`^${name}:\\s*(.+)`, "im").exec(raw.toString("latin1"))?.[1]?.trim() ?? "";

/** A stateful in-memory Microsoft Graph v1.0 mail API plus the Entra token endpoint. Shapes follow the public docs (unverified live, P2-T07). */
export function createFakeGraph(address = "me@rn.test") {
  const msgs = new Map<string, Msg>();
  const events: Ev[] = [];
  let seq = 0;
  let evn = 0;
  let validToken = "at-0";
  let tokenN = 0;
  let revoked = false;
  let fail: string | undefined;
  let tokenFail = false;
  let rewriteIds = false;
  const store = memoryStore({ scope: SCOPE });
  const stats = { tokenCalls: 0, sendCalls: 0, draftCalls: 0 };

  const ev = (folder: FolderName, id: string, removed?: Ev["removed"]) =>
    events.push({ n: ++evn, folder, id, removed });
  const add = (raw: Buffer, folder: FolderName, o: { isDraft?: boolean; from?: string } = {}) => {
    seq++;
    const m: Msg = {
      id: `AAMk${seq}`,
      folder,
      raw,
      isDraft: o.isDraft ?? false,
      seq,
      from: (
        o.from ??
        /<?([^<>\s]+@[^<>\s]+)>?/.exec(header(raw, "from"))?.[1] ??
        ""
      ).toLowerCase(),
      conv: `conv${seq}`,
    };
    msgs.set(m.id, m);
    if (!m.isDraft) ev(folder, m.id);
    return m;
  };
  const move = (id: string, to: FolderName) => {
    const m = msgs.get(id)!;
    if (!m.isDraft) ev(m.folder, id, "changed");
    m.folder = to;
    if (!m.isDraft && to !== "drafts") ev(to, id);
  };
  const remove = (id: string) => {
    const m = msgs.get(id)!;
    msgs.delete(id);
    if (!m.isDraft) ev(m.folder, id, "deleted");
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
  const received = (m: Msg) => new Date(Date.UTC(2024, 0, 1) + m.seq * 1000);
  const tick = () => new Promise((r) => setImmediate(r));
  const dto = (m: Msg) => ({
    id: m.id,
    conversationId: m.conv,
    internetMessageId: header(m.raw, "message-id"),
    parentFolderId: `F-${m.folder}`,
    isDraft: m.isDraft,
    from: { emailAddress: { address: m.from } },
  });
  const deliver = (m: Msg) => {
    m.isDraft = false;
    if (rewriteIds)
      m.raw = Buffer.from(
        m.raw
          .toString("latin1")
          .replace(/^message-id:.*$/im, `Message-ID: <rw${m.seq}@prod.outlook.com>`),
        "latin1",
      );
    // delivered copy carries no Bcc (the Sent copy keeping it is unverified against live Graph)
    m.raw = Buffer.from(
      m.raw.toString("latin1").replace(/^bcc:.*(\r\n[ \t].*)*\r\n/im, ""),
      "latin1",
    );
    m.folder = "sentitems";
    ev("sentitems", m.id);
  };

  /** OData paging over a list: `$skiptoken` is the offset; the next link is this URL with the token set. */
  const listPage = (all: Msg[], u: URL, max: number) => {
    const off = Number(u.searchParams.get("$skiptoken") ?? 0);
    const items = all.slice(off, off + max);
    const next = new URL(u);
    next.searchParams.set("$skiptoken", String(off + max));
    return {
      value: items.map(dto),
      ...(off + max < all.length ? { "@odata.nextLink": next.toString() } : {}),
    };
  };
  const filterOf = (u: URL) => u.searchParams.get("$filter") ?? "";

  const delta = (folder: FolderName, u: URL, max: number) => {
    const link = (k: string, v: string) => {
      const x = new URL(`${G}/me/mailFolders/${folder}/messages/delta`);
      x.searchParams.set("$select", "id");
      x.searchParams.set(k, v);
      return x.toString();
    };
    const skip = u.searchParams.get("$skiptoken");
    const dt = u.searchParams.get("$deltatoken");
    if (!skip && dt === null) {
      // initial round: with a receivedDateTime filter, only matching messages, then a deltaLink at "now"
      const ge = /receivedDateTime ge (\S+)/.exec(filterOf(u))?.[1];
      const all = [...msgs.values()].filter(
        (m) => m.folder === folder && !m.isDraft && (!ge || received(m) >= new Date(ge)),
      );
      return json(200, {
        value: all.map((m) => ({ id: m.id })),
        "@odata.deltaLink": link("$deltatoken", String(evn)),
      });
    }
    let start: number;
    let off = 0;
    if (skip) {
      const [s, o] = skip.split("_");
      start = Number(s);
      off = Number(o);
    } else start = Number(dt);
    const latest = new Map<string, Ev>();
    for (const e of events.filter((e) => e.n > start && e.folder === folder)) latest.set(e.id, e);
    const evs = [...latest.values()];
    const page = evs.slice(off, off + max);
    const value = page.map((e) =>
      e.removed ? { id: e.id, "@removed": { reason: e.removed } } : { id: e.id },
    );
    return json(200, {
      value,
      ...(off + max < evs.length
        ? { "@odata.nextLink": link("$skiptoken", `${start}_${off + max}`) }
        : { "@odata.deltaLink": link("$deltatoken", String(evn)) }),
    });
  };

  const maxPage = (h: Record<string, string>, d: number) =>
    Number(/odata\.maxpagesize=(\d+)/.exec(h.prefer ?? "")?.[1] ?? d);

  const handler = async (
    method: string,
    u: URL,
    req: { headers: Record<string, string>; body?: string },
  ): Promise<Response> => {
    const path = u.pathname.replace("/v1.0", "");
    let m: RegExpExecArray | null;
    if (method === "GET" && path === "/me")
      return json(200, { mail: address, userPrincipalName: address, displayName: "Me" });
    if (method === "POST" && path === "/me/messages") {
      stats.draftCalls++;
      const f = fail;
      if (f === "rate_limit")
        return ((fail = undefined), err(429, "TooManyRequests", { "retry-after": "7" }));
      if (f === "auth_revoked")
        return ((fail = undefined), (revoked = true), err(401, "InvalidAuthenticationToken"));
      if (f === "connect_refused") {
        fail = undefined;
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      }
      if (f === "draft_5xx") return ((fail = undefined), err(503, "ServiceNotAvailable"));
      if (f === "draft_429_no_header") return ((fail = undefined), err(429, "TooManyRequests"));
      const raw = Buffer.from(req.body!, "base64");
      const d = add(raw, "drafts", { isDraft: true });
      // Graph threads by In-Reply-To/References: a reply joins the conversation of the message it answers
      const parent = [...msgs.values()].find(
        (x) => header(x.raw, "message-id") === header(raw, "in-reply-to"),
      );
      if (parent) d.conv = parent.conv;
      return json(201, dto(d));
    }
    if (method === "POST" && (m = /^\/me\/messages\/([^/]+)\/send$/.exec(path))) {
      stats.sendCalls++;
      const f = fail;
      const d = msgs.get(m[1]!);
      if (!d) return err(404, "ErrorItemNotFound");
      if (f === "permanent_rejected")
        return ((fail = undefined), err(400, "ErrorInvalidRecipients"));
      if (f === "rate_limit_send")
        return ((fail = undefined), err(429, "TooManyRequests", { "retry-after": "120" }));
      if (f === "api_5xx") return ((fail = undefined), deliver(d), err(503, "ServiceNotAvailable"));
      if (f === "timeout_after_write") {
        fail = undefined;
        deliver(d);
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      }
      deliver(d);
      return new Response(null, { status: 202 });
    }
    if (method === "DELETE" && (m = /^\/me\/messages\/([^/]+)$/.exec(path))) {
      if (!msgs.has(m[1]!)) return err(404, "ErrorItemNotFound");
      remove(m[1]!);
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && (m = /^\/me\/messages\/([^/]+)\/\$value$/.exec(path))) {
      const x = msgs.get(m[1]!);
      return x
        ? new Response(new Uint8Array(x.raw), {
            status: 200,
            headers: { "content-type": "text/plain" },
          })
        : err(404, "ErrorItemNotFound");
    }
    if (method === "GET" && (m = /^\/me\/messages\/([^/]+)$/.exec(path))) {
      const x = msgs.get(m[1]!);
      return x ? json(200, dto(x)) : err(404, "ErrorItemNotFound");
    }
    if (method === "GET" && (m = /^\/me\/mailFolders\/(\w+)$/.exec(path)))
      return json(200, { id: `F-${m[1]}` });
    if (method === "GET" && (m = /^\/me\/mailFolders\/(\w+)\/messages\/delta$/.exec(path))) {
      if (fail === "delta_503")
        return ((fail = undefined), err(503, "ServiceNotAvailable", { "retry-after": "30" }));
      if (floor && Number(u.searchParams.get("$deltatoken") ?? Infinity) < floor)
        return err(410, "SyncStateNotFound");
      return delta(m[1] as FolderName, u, maxPage(req.headers, 100));
    }
    const list = /^\/me\/(?:mailFolders\/(\w+)\/)?messages$/.exec(path);
    if (method === "GET" && list) {
      let all = [...msgs.values()].filter((x) => (list[1] ? x.folder === list[1] : true));
      const idEq = /internetMessageId eq '((?:[^']|'')*)'/
        .exec(filterOf(u))?.[1]
        ?.replace(/''/g, "'");
      const ge = /receivedDateTime ge (\S+)/.exec(filterOf(u))?.[1];
      if (idEq) all = all.filter((x) => header(x.raw, "message-id") === idEq);
      if (ge) all = all.filter((x) => received(x) >= new Date(ge));
      if (list[1] && list[1] !== "drafts") all = all.filter((x) => !x.isDraft);
      return json(200, listPage(all, u, Number(u.searchParams.get("$top") ?? 100)));
    }
    return err(404, "ErrorNotFound");
  };

  let floor = 0;
  const fetch = createFixtureFetch([
    {
      method: "POST",
      url: TOKEN_URL,
      respond: async () => {
        stats.tokenCalls++;
        if (tokenFail)
          return ((tokenFail = false), json(503, { error: "temporarily_unavailable" }));
        if (revoked)
          return json(400, { error: "invalid_grant", error_description: "AADSTS70008 expired" });
        validToken = `at-${++tokenN}`;
        return json(200, {
          access_token: validToken,
          refresh_token: `rt-${tokenN}`,
          expires_in: 3600,
          scope: SCOPE,
          token_type: "Bearer",
        });
      },
    },
    ...(["GET", "POST", "DELETE"] as const).map((method) => ({
      method,
      url: /^https:\/\/graph\.microsoft\.com\/v1\.0\//,
      respond: async (req: { url: string; body?: string; headers: Record<string, string> }) => {
        if (revoked || req.headers.authorization !== `Bearer ${validToken}`)
          return err(401, "InvalidAuthenticationToken");
        await tick(); // lets concurrent requests overlap so the recorded concurrency is real
        return handler(method, new URL(req.url), req);
      },
    })),
  ]);

  let n = 0;
  const scenario: Scenario = {
    async receiveInbound(x) {
      const id = `<in${++n}@x.test>`;
      add(
        simple({ from: x.from.email, to: address, subject: x.subject, id, inReplyTo: x.inReplyTo }),
        "inbox",
      );
      return { rfcMessageId: id };
    },
    async seedInbound(count) {
      for (let i = 0; i < count; i++)
        add(
          simple({ from: "x@rn.test", to: address, subject: `s${i}`, id: `<seed${i}@x.test>` }),
          "inbox",
        );
    },
    async receiveSpam() {
      const id = `<spam${++n}@x.test>`;
      add(simple({ from: "s@x.test", to: address, subject: "spam", id }), "junkemail");
      return { rfcMessageId: id };
    },
    async saveDraft() {
      const id = `<draft${++n}@rn.test>`;
      add(simple({ from: address, to: "d@x.test", subject: "draft", id }), "drafts", {
        isDraft: true,
      });
      return { rfcMessageId: id };
    },
    async sendExternal(x) {
      add(
        simple({ from: address, to: "o@x.test", subject: x.subject, id: x.messageId }),
        "sentitems",
      );
    },
    async deleteMessage(id) {
      remove(id);
    },
    failNext(k) {
      if (k === "token_5xx") {
        tokenFail = true;
        store.expire(); // forces a refresh before the send
      } else fail = k;
    },
    async expireCursors() {
      floor = ++evn;
    },
    sentRaw: async () =>
      [...msgs.values()].filter((x) => x.folder === "sentitems").map((x) => x.raw),
  };
  return {
    fetch,
    store,
    stats,
    scenario,
    msgs,
    add,
    move,
    remove,
    simple,
    rewriteIds: () => (rewriteIds = true),
    failWith: (k: string) => (fail = k),
    revoke: () => (revoked = true),
  };
}
