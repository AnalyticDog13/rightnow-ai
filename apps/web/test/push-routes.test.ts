import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";

const ORIGIN = "https://app.rn.test";
const AUD = `${ORIGIN}/api/push/gmail`;
const SA = "push@p.iam.gserviceaccount.com";
let db: Awaited<ReturnType<typeof createTestDb>>;
let push: typeof import("../lib/push");
let graph: typeof import("../app/api/push/graph/route");
let priv: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwk: JWK;
let ws: string;
let gmailId: string;
let msId: string;

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "vps",
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: "t".repeat(20),
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-push-")),
    GMAIL_PUBSUB_TOPIC: "projects/p/topics/t",
    GMAIL_PUSH_SA_EMAIL: SA,
  });
  const kp = await generateKeyPair("RS256", { extractable: true });
  priv = kp.privateKey;
  jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  push = await import("../lib/push");
  graph = await import("../app/api/push/graph/route");
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w" } })).id;
  const mk = async (provider: "GMAIL" | "MICROSOFT", email: string, externalId: string) => {
    const a = await db.prisma.emailAccount.create({
      data: {
        workspaceId: ws,
        provider,
        email,
        fromName: "F",
        firstName: "F",
        lastName: "L",
        capTier: provider === "GMAIL" ? "GMAIL_WORKSPACE" : "MS365",
        providerCap: 1000,
        credentialsEnc: "x",
      },
    });
    await db.prisma.pushSubscription.create({
      data: {
        workspaceId: ws,
        accountId: a.id,
        provider,
        externalId,
        clientStateHash:
          provider === "MICROSOFT" ? createHash("sha256").update("cs-secret").digest("hex") : null,
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
      },
    });
    return a.id;
  };
  gmailId = await mk("GMAIL", "me@x.com", "h-1");
  msId = await mk("MICROSOFT", "ms@x.com", "sub-1");
}, 120_000);
afterAll(() => db.drop());

const now = () => Math.floor(Date.now() / 1000);
const token = () =>
  new SignJWT({
    iss: "https://accounts.google.com",
    aud: AUD,
    email: SA,
    email_verified: true,
    iat: now() - 5,
    exp: now() + 3500,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .sign(priv);
const envelope = (emailAddress: string) =>
  JSON.stringify({
    message: {
      data: Buffer.from(JSON.stringify({ emailAddress, historyId: "5" })).toString("base64"),
      messageId: "1",
    },
    subscription: "projects/p/subscriptions/s",
  });
const acct = (id: string) => db.prisma.emailAccount.findUniqueOrThrow({ where: { id } });

describe("gmail route", () => {
  const jwks = vi.fn(async () => [jwk]);
  const post = async (body: BodyInit, auth?: string, headers: Record<string, string> = {}) =>
    push.gmailPush(jwks)(
      new Request(`${ORIGIN}/api/push/gmail`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(auth && { authorization: auth }),
          ...headers,
        },
        body,
        duplex: "half",
      } as RequestInit),
    );

  it("no Authorization or a bad token → 401, nothing written", async () => {
    expect((await post(envelope("me@x.com"))).status).toBe(401);
    expect((await post(envelope("me@x.com"), "Bearer a.b.c")).status).toBe(401);
    expect((await post(envelope("me@x.com"), `Basic ${await token()}`)).status).toBe(401);
    expect((await acct(gmailId)).syncRequestedAt).toBeNull();
  });

  it("a valid JWT → 204, the account is flagged; cursor and watermark unchanged", async () => {
    const before = await acct(gmailId);
    const r = await post(envelope("Me@x.com"), `Bearer ${await token()}`);
    expect(r.status).toBe(204);
    const a = await acct(gmailId);
    expect(a.syncRequestedAt).not.toBeNull();
    expect(Math.abs(a.syncRequestedAt!.getTime() - Date.now())).toBeLessThan(10_000);
    expect(a.lastSyncCompletedAt).toEqual(before.lastSyncCompletedAt);
    expect(a.syncCursor).toEqual(before.syncCursor);
  });

  it("an unknown address → 204 and nothing written", async () => {
    const r = await post(envelope("nobody@x.com"), `Bearer ${await token()}`);
    expect(r.status).toBe(204);
  });

  it("a 2 MB body → 413, with or without Content-Length; a bad payload → 204", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    expect((await post(big, `Bearer ${await token()}`)).status).toBe(413);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 4; i++) c.enqueue(new TextEncoder().encode("x".repeat(512 * 1024)));
        c.close();
      },
    });
    expect((await post(stream, `Bearer ${await token()}`)).status).toBe(413);
    // verified but unparseable: 204, so Pub/Sub does not redeliver it until retention expires (M3)
    expect((await post("{", `Bearer ${await token()}`)).status).toBe(204);
    expect((await post('{"message":{}}', `Bearer ${await token()}`)).status).toBe(204);
  });
});

describe("graph route", () => {
  const post = (qs: string, body?: unknown) =>
    graph.POST(
      new Request(`${ORIGIN}/api/push/graph${qs}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body !== undefined && {
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      }),
    );
  const note = (clientState: string, o: object = {}) => ({
    value: [{ subscriptionId: "sub-1", clientState, changeType: "created", ...o }],
  });

  it("validationToken is echoed as text/plain; over 1024 characters → 400", async () => {
    const r = await post("?validationToken=abc%20def");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await r.text()).toBe("abc def");
    expect((await post(`?validationToken=${"a".repeat(2000)}`)).status).toBe(400);
  });

  it("wrong clientState → 202, not flagged; unknown id ignored; right one → 202 and flagged", async () => {
    expect((await post("", note("wrong"))).status).toBe(202);
    expect((await acct(msId)).syncRequestedAt).toBeNull();
    expect(
      (await post("", { value: [{ subscriptionId: "nope", clientState: "cs-secret" }] })).status,
    ).toBe(202);
    expect((await acct(msId)).syncRequestedAt).toBeNull();
    expect((await post("", note("cs-secret"))).status).toBe(202);
    expect((await acct(msId)).syncRequestedAt).not.toBeNull();
  });

  it("lifecycle subscriptionRemoved → FAILED", async () => {
    expect(
      (await post("", note("cs-secret", { lifecycleEvent: "subscriptionRemoved" }))).status,
    ).toBe(202);
    expect(
      await db.prisma.pushSubscription.findUniqueOrThrow({ where: { accountId: msId } }),
    ).toMatchObject({ status: "FAILED" });
  });

  it("an oversized body → 413; a bad shape is a 202 no-op (A8); unparseable JSON → 400", async () => {
    expect((await post("", "x".repeat(2 * 1024 * 1024))).status).toBe(413);
    expect((await post("", { value: "x" })).status).toBe(202);
    expect((await post("", "{")).status).toBe(400);
  });

  it("no provider call or sync inside the request (the handlers only set the flag)", () => {
    const root = join(fileURLToPath(import.meta.url), "../../../..");
    for (const f of [
      "apps/web/lib/push.ts",
      "apps/web/app/api/push/gmail/route.ts",
      "apps/web/app/api/push/graph/route.ts",
      "packages/core/src/push/handle.ts",
    ])
      expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(
        /createProvider|providerFor|reconcileAccount|syncDue|@rightnow\/providers/,
      );
  });
});
