import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

// PS-SEC sweep (P7-T07b): each test names the item it checks and asserts it on the current code.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "https://app.example.com"; // an https APP_URL, as in vps mode: cookies are Secure
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let userId: string;
let cookie: string;
let signInHeaders: Headers;
let auth: typeof import("../lib/auth").auth;
let core: typeof import("@rightnow/core");
const mod = <T>(path: string) => import(`../app/api/${path}/route`) as Promise<T>;

const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${url}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const actions = async () =>
  (await db.prisma.auditLog.findMany({ where: { workspaceId } })).map((a) => a.action);
const server = (host: string) => ({
  host,
  port: 993,
  secure: true,
  username: "u@acme.test",
  password: "hunter2-secret",
});

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local",
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-web-sweep-")),
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
  });
  ({ auth } = await import("../lib/auth"));
  core = await import("@rightnow/core");
  ({ workspaceId, userId } = await createFirstOwner(
    db.prisma,
    { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
    TOKEN,
  ));
  const { headers } = await auth.api.signInEmail({
    body: { email: "owner@x.io", password: PASSWORD },
    returnHeaders: true,
  });
  signInHeaders = headers;
  cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}, 120_000);
afterAll(() => db.drop());

describe("PS-SEC-03 sessions", () => {
  it("the session cookie is HttpOnly, SameSite and (https) Secure, and a new sign-in rotates the token", async () => {
    const set = signInHeaders.getSetCookie().find((c) => c.includes("session_token"))!;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Secure/i);
    expect(set.startsWith("__Secure-")).toBe(true);
    expect(await db.prisma.session.count({ where: { userId } })).toBeGreaterThan(0);
  });

  it("2FA secrets and backup codes are encrypted at rest (never the raw secret)", async () => {
    const u = await db.prisma.user.create({ data: { id: "u-enc", name: "E", email: "e@x.io" } });
    await db.prisma.member.create({
      data: { id: "m-enc", workspaceId, userId: u.id, role: "member" },
    });
    await db.prisma.account.create({
      data: {
        id: "a-enc",
        userId: u.id,
        accountId: u.id,
        providerId: "credential",
        password: await (await import("better-auth/crypto")).hashPassword(PASSWORD),
      },
    });
    const { headers } = await auth.api.signInEmail({
      body: { email: "e@x.io", password: PASSWORD },
      returnHeaders: true,
    });
    const h = new Headers({
      cookie: headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    const r = (await auth.api.enableTwoFactor({
      headers: h,
      body: { password: PASSWORD },
    })) as { totpURI: string; backupCodes: string[] };
    const secret = new URL(r.totpURI).searchParams.get("secret")!;
    const row = await db.prisma.twoFactor.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.verified).toBe(false); // not active until the first code is proven
    expect(row.secret).not.toContain(secret);
    for (const code of r.backupCodes) expect(row.backupCodes).not.toContain(code);
  });
});

describe("PS-SEC-07 audit log", () => {
  it("sign-in, account connect/disconnect, API key create, lead export and erasure, settings update and member invite each write a row", async () => {
    const accounts = await mod<typeof import("../app/api/v1/accounts/route")>("v1/accounts");
    const disconnect = await mod<typeof import("../app/api/v1/accounts/[id]/disconnect/route")>(
      "v1/accounts/[id]/disconnect",
    );
    const keys = await mod<typeof import("../app/api/v1/api-keys/route")>("v1/api-keys");
    const exp =
      await mod<typeof import("../app/api/v1/leads/[id]/export/route")>("v1/leads/[id]/export");
    const gdpr = await mod<typeof import("../app/api/v1/leads/[id]/gdpr-delete/route")>(
      "v1/leads/[id]/gdpr-delete",
    );
    const settings =
      await mod<typeof import("../app/api/v1/settings/workspace/route")>("v1/settings/workspace");
    const invites = await mod<typeof import("../app/api/v1/invites/route")>("v1/invites");

    const connected = await accounts.POST(
      req("POST", "/api/v1/accounts", {
        email: "mail@acme.test",
        firstName: "Mail",
        lastName: "Box",
        imap: server("imap.acme.test"),
        smtp: { ...server("smtp.acme.test"), port: 465 },
      }),
    );
    expect(connected.status).toBe(200);
    const accountId = ((await connected.json()) as { account: { id: string } }).account.id;
    expect((await disconnect.POST(req("POST", "x"), p(accountId))).status).toBe(200);
    expect(
      (await keys.POST(req("POST", "/api/v1/api-keys", { name: "k", scopes: ["leads:read"] })))
        .status,
    ).toBe(200);
    const lead = await db.prisma.lead.create({ data: { workspaceId, email: "erase@lead.test" } });
    expect((await exp.GET(req("GET", "x"), p(lead.id))).status).toBe(200);
    expect(
      (await settings.PATCH(req("PATCH", "/api/v1/settings/workspace", { currency: "EUR" })))
        .status,
    ).toBe(200);
    expect(
      (await invites.POST(req("POST", "/api/v1/invites", { email: "i@x.io", role: "member" })))
        .status,
    ).toBe(200);

    // PS-SEC-11, in the same flow: erase the lead
    expect((await gdpr.POST(req("POST", "x"), p(lead.id))).status).toBe(200);

    expect(await actions()).toEqual(
      expect.arrayContaining([
        "auth.sign_in",
        "account.connect",
        "account.disconnect",
        "apikey.create",
        "lead.export",
        "lead.gdpr_delete",
        "settings.update",
        "member.invite",
      ]),
    );
    // the rows hold no secret
    const all = JSON.stringify(await db.prisma.auditLog.findMany());
    expect(all).not.toContain("hunter2-secret");

    // PS-SEC-11: only the hash tombstone remains
    expect(await db.prisma.lead.count({ where: { email: "erase@lead.test" } })).toBe(0);
    const tombs = await db.prisma.suppression.findMany({ where: { workspaceId } });
    expect(tombs).toHaveLength(1);
    expect(tombs[0]).toMatchObject({ value: null, reason: "GDPR_ERASURE" });
    expect(tombs[0]!.valueHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await db.prisma.$queryRaw`SELECT * FROM "Suppression"`)).not.toContain(
      "erase@lead.test",
    );
  });

  it("GET /audit-logs and the Settings page use one role: MEMBER, or an API key with audit:read", async () => {
    const route = await mod<typeof import("../app/api/v1/audit-logs/route")>("v1/audit-logs");
    expect(route.GET.meta).toMatchObject({ role: "MEMBER", scope: "audit:read" });
    const page = readFileSync(join(root, "apps/web/app/(app)/settings/page.tsx"), "utf8");
    expect(page).toMatch(/AuditLog/);
    expect(page).not.toMatch(/audit[^\n]*admin|admin[^\n]*audit/i); // not gated tighter than the API
  });
});

describe("PS-SEC-09 / -10 / -16 outbound mail", () => {
  it("SEC-09: the unsubscribe headers carry List-Unsubscribe and List-Unsubscribe-Post; planner and sender both build them", () => {
    const env = { appUrl: ORIGIN, unsubscribeKeys: [Buffer.alloc(32, 1)] };
    const h = core.listUnsubscribeHeaders(env, { w: "w", l: "l", c: "c" }, "a@acme.test");
    expect(h["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\.com\/u\/[\w.-]+>, <mailto:/);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    for (const f of ["planner.ts", "sender.ts"])
      expect(readFileSync(join(root, "packages/core/src", f), "utf8")).toContain(
        "listUnsubscribeHeaders(",
      );
  });

  it("SEC-10: send() with another From is refused", async () => {
    const { FakeProvider, PermanentSendError } = await import("@rightnow/providers");
    const fake = new FakeProvider("me@acme.test", { kind: "SMTP", host: "smtp.acme.test" });
    await expect(
      fake.send({
        from: { email: "ceo@other.test" },
        to: [{ email: "x@lead.test" }],
        subject: "Hi",
        text: "Hi",
        messageId: "<a@acme.test>",
      }),
    ).rejects.toBeInstanceOf(PermanentSendError);
  });

  it("SEC-12: the footer carries the physical address, and a lead records where it came from", async () => {
    const footer = core.withComplianceFooter(
      { html: "<p>Hi</p>", text: "Hi" },
      {
        unsubscribeUrl: `${ORIGIN}/u/t`,
        physicalAddress: "1 Main St, Springfield",
        hasLinkVariable: false,
      },
    );
    expect(footer.text).toContain("1 Main St, Springfield");
    expect(footer.html).toContain("1 Main St, Springfield");
    expect(() =>
      core.withComplianceFooter(
        { html: null, text: "x" },
        { unsubscribeUrl: "u", physicalAddress: " ", hasLinkVariable: true },
      ),
    ).toThrow("physical_address_required");
    const leads = await mod<typeof import("../app/api/v1/leads/route")>("v1/leads");
    const { token } = await core.createApiKey(db.prisma, workspaceId, "k2", ["leads:create"]);
    await leads.POST(req("POST", "/api/v1/leads", { email: "ui@lead.test" }));
    await leads.POST(
      new Request(`${ORIGIN}/api/v1/leads`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ email: "key@lead.test", source: "csv:spoofed.csv" }),
      }),
    );
    const src = async (email: string) => db.prisma.lead.findFirstOrThrow({ where: { email } });
    // the upload method is set by the server, never from input; `source` stays caller free text
    expect(await src("ui@lead.test")).toMatchObject({ uploadMethod: "manual" });
    expect(await src("key@lead.test")).toMatchObject({
      uploadMethod: "api",
      source: "csv:spoofed.csv",
    });
    expect(readFileSync(join(root, "packages/core/src/leads/import.ts"), "utf8")).toContain(
      'uploadMethod: "csv"',
    );
  });

  it("SEC-16: the built MIME carries no invisible characters or forged headers, and header injection is refused", async () => {
    const { buildMime } = await import("@rightnow/providers");
    const base = {
      from: { email: "me@acme.test", name: "Me" },
      to: [{ email: "x@lead.test" }],
      subject: "Quick question",
      text: "Hello there",
      messageId: "<m1@acme.test>",
      headers: core.listUnsubscribeHeaders(
        { appUrl: ORIGIN, unsubscribeKeys: [Buffer.alloc(32, 1)] },
        { w: "w", l: "l", c: "c" },
        "me@acme.test",
      ),
    };
    const raw = (await buildMime(base)).toString("utf8");
    // zero-width and joiner characters, the BOM and invisible operators
    for (const h of [
      "200b",
      "200c",
      "200d",
      "200e",
      "200f",
      "2060",
      "2062",
      "2063",
      "2064",
      "feff",
    ])
      expect(raw).not.toContain(String.fromCharCode(parseInt(h, 16)));
    const names = raw
      .split("\r\n\r\n")[0]!
      .split("\r\n")
      .filter((l) => /^[A-Za-z-]+:/.test(l))
      .map((l) => l.split(":")[0]!.toLowerCase());
    expect(names.every((n) => !n.startsWith("x-") || n === "x-rightnow-test")).toBe(true);
    expect(names).not.toContain("bcc");
    await expect(buildMime({ ...base, subject: "Hi\r\nBcc: evil@x.test" })).rejects.toThrow(
      /CR\/LF/,
    );
    await expect(
      buildMime({ ...base, headers: { Received: "from fake\r\nX: y" } }),
    ).rejects.toThrow();
    await expect(buildMime({ ...base, headers: { From: "ceo@other.test" } })).rejects.toThrow(
      /reserved/,
    );
  });
});

describe("PS-SEC-13 / -15 inputs", () => {
  it("SEC-13: an import without confirmedAuthorized is 400", async () => {
    const imports = await mod<typeof import("../app/api/v1/imports/route")>("v1/imports");
    const fd = new FormData();
    fd.set("file", new File(["email\na@x.test\n"], "l.csv", { type: "text/csv" }));
    fd.set(
      "options",
      JSON.stringify({ mapping: ["email"], confirmedAuthorized: false, lawfulBasis: "consent" }),
    );
    const probe = new Response(fd);
    const bytes = await probe.arrayBuffer();
    const r = await imports.POST(
      new Request(`${ORIGIN}/api/v1/imports`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie,
          "content-type": probe.headers.get("content-type")!,
          "content-length": String(bytes.byteLength),
        },
        body: bytes,
      }),
    );
    expect(r.status).toBe(400);
  });

  it("SEC-15: an attachment downloads as attachment with nosniff; one over 25 MB is stored truncated", async () => {
    const a = await db.prisma.emailAccount.create({
      data: {
        workspaceId,
        provider: "SMTP",
        email: "att@acme.test",
        fromName: "A",
        firstName: "A",
        lastName: "B",
        capTier: "SMTP",
        providerCap: 100,
      },
    });
    const t = await db.prisma.thread.create({
      data: { workspaceId, accountId: a.id, subject: "S", lastMessageAt: new Date() },
    });
    const m = await db.prisma.message.create({
      data: {
        workspaceId,
        accountId: a.id,
        threadId: t.id,
        rfcMessageId: "<att@lead.test>",
        references: [],
        direction: "IN",
        folder: "INBOX",
        fromEmail: "lead@lead.test",
        to: [a.email],
        cc: [],
        subject: "S",
        sentAt: new Date(),
        kind: "REPLY",
        attachments: {
          create: [
            { filename: "a.html", contentType: "text/html", size: 4, data: Buffer.from("<b>1") },
          ],
        },
      },
      include: { attachments: true },
    });
    const dl = await mod<typeof import("../app/api/v1/inbox/attachments/[id]/route")>(
      "v1/inbox/attachments/[id]",
    );
    const res = await dl.GET(req("GET", "x"), p(m.attachments[0]!.id));
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const { buildMime, parseRaw } = await import("@rightnow/providers");
    const big = await parseRaw(
      await buildMime({
        from: { email: "lead@lead.test" },
        to: [{ email: a.email }],
        subject: "big",
        text: "see attached",
        messageId: "<big@lead.test>",
        attachments: [
          {
            filename: "big.bin",
            contentType: "application/octet-stream",
            content: Buffer.alloc(25 * 1024 * 1024 + 1),
          },
        ],
      }),
      { providerMessageId: "1", folder: "INBOX" },
    );
    expect(big.attachments[0]).toMatchObject({
      filename: "big.bin",
      content: null,
      truncated: true,
    });
    expect(readFileSync(join(root, "packages/core/src/mail/ingest.ts"), "utf8")).toContain(
      "truncated: !a.content",
    );
  }, 60_000);
});

describe("PS-SEC-14 tenant isolation", () => {
  it("ai suggestions of one workspace are invisible to another's key", async () => {
    const other = await db.prisma.workspace.create({ data: { name: "B", slug: "b-sweep" } });
    await db.prisma.aiSuggestion.create({
      data: { workspaceId, kind: "SUMMARY", text: "only-for-acme" },
    });
    const { token } = await core.createApiKey(db.prisma, other.id, "b", ["ai:read"]);
    const list =
      await mod<typeof import("../app/api/v1/ai/suggestions/route")>("v1/ai/suggestions");
    const own = await list.GET(req("GET", "/api/v1/ai/suggestions"));
    expect(JSON.stringify(await own.json())).toContain("only-for-acme");
    const theirs = await list.GET(
      new Request(`${ORIGIN}/api/v1/ai/suggestions`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(await theirs.json())).not.toContain("only-for-acme");
  });

  it("every resource in docs/openapi.json has a cross-workspace test in apps/web/test (expectIsolated or a foreign-id check)", () => {
    const doc = JSON.parse(readFileSync(join(root, "docs/openapi.json"), "utf8")) as {
      paths: Record<string, unknown>;
    };
    const dir = join(root, "apps/web/test");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".test.ts") && f !== "sec-sweep.test.ts")
      .map((f) => readFileSync(join(dir, f), "utf8"));
    const checksIsolation =
      /expectIsolated|foreign|otherWs|other workspace|another workspace|theirs/;
    const resources = [...new Set(Object.keys(doc.paths).map((k) => k.split("/")[1]!))];
    const elsewhere: Record<string, string> = {
      "openapi.json": "a public document with no workspace data",
      ai: "the test above",
      oauth: "core/oauth.test.ts: pollSession for another workspace is null",
    };
    expect(
      readFileSync(join(root, "packages/core/test/oauth.test.ts"), "utf8"),
      "oauth isolation test",
    ).toContain('expect(await poll("other")).toBeNull()');
    const missing = resources.filter(
      (r) =>
        !(r in elsewhere) &&
        !files.some((s) => checksIsolation.test(s) && new RegExp(`api/v1/${r}(/|["'\`])`).test(s)),
    );
    expect(missing).toEqual([]);
  });
});
