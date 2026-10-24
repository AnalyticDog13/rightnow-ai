import { createHash, createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider, type MailProvider } from "@rightnow/providers";
import { exportJWK, exportSPKI, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { fixedClock } from "../src/clock";
import { reconcileAccount, syncDue, type SyncDeps } from "../src/mail/sync";
import { handleGmailPush, handleGraphPush, PUSH_MIN_GAP_SEC } from "../src/push/handle";
import { verifyGoogleJwt } from "../src/push/verify";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "push-"));

const T0 = new Date("2026-11-02T10:00:00Z");
const s = (d: Date) => Math.floor(d.getTime() / 1000);
const AUD = "https://app.rn.test/api/push/gmail";
const SA = "push@p.iam.gserviceaccount.com";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const b64u = (v: object | string) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

let priv: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwk: JWK;
let pem: string;
beforeAll(async () => {
  const kp = await generateKeyPair("RS256", { extractable: true });
  priv = kp.privateKey;
  jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  pem = await exportSPKI(kp.publicKey);
});

const claims = (o: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: AUD,
  email: SA,
  email_verified: true,
  iat: s(T0) - 10,
  exp: s(T0) + 3590,
  ...o,
});
const sign = (o: Record<string, unknown> = {}, kid = "k1") =>
  new SignJWT(claims(o)).setProtectedHeader({ alg: "RS256", kid, typ: "JWT" }).sign(priv);
const verify = (token: string, jwks: () => Promise<JWK[]> = async () => [jwk], now = T0) =>
  verifyGoogleJwt(token, { audience: AUD, email: SA, now, jwks });

describe("push verification", () => {
  test("a valid token → true", async () => {
    expect(await verify(await sign())).toBe(true);
    expect(await verify(await sign({ iss: "accounts.google.com" }))).toBe(true);
  });

  test("forged and wrong tokens → false", async () => {
    const jwks = async () => [jwk];
    const none = `${b64u({ alg: "none", kid: "k1" })}.${b64u(claims())}.`;
    const hsInput = `${b64u({ alg: "HS256", kid: "k1", typ: "JWT" })}.${b64u(claims())}`;
    const hs = `${hsInput}.${createHmac("sha256", pem).update(hsInput).digest("base64url")}`;
    const good = await sign();
    const forged = `${good.split(".").slice(0, 2).join(".")}.${b64u("x".repeat(256))}`;
    const noKid = await new SignJWT(claims()).setProtectedHeader({ alg: "RS256" }).sign(priv);
    for (const t of [
      none,
      hs,
      forged,
      noKid,
      await sign({ aud: "https://evil.test/api/push/gmail" }),
      await sign({ email: "other@p.iam.gserviceaccount.com" }),
      await sign({ email_verified: false }),
      await sign({ email_verified: "true" }),
      await sign({ exp: s(T0) - 120, iat: s(T0) - 3600 }),
      await sign({ iat: s(T0) + 300 }),
      await sign({ iss: "https://evil.test" }),
      "a.b",
      "",
      "...",
    ])
      expect(await verify(t, jwks), t.slice(0, 40)).toBe(false);
  });

  test("an unknown kid 50 times within one minute → at most one refetch", async () => {
    const fetcher = vi.fn(async () => [jwk]);
    expect(await verify(await sign(), fetcher)).toBe(true);
    const bad = await sign({}, "k-unknown");
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => verify(bad, fetcher, new Date(T0.getTime() + i * 1000))),
    );
    expect(results.every((r) => r === false)).toBe(true);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
    // a rotated key is found once a minute has passed
    const later = new Date(T0.getTime() + 61_000);
    fetcher.mockImplementation(async () => [jwk, { ...jwk, kid: "k-unknown" }]);
    expect(await verify(bad, fetcher, later)).toBe(true);
  });

  test("a JWKS fetch that fails → false, no throw, and no refetch storm", async () => {
    const fetcher = vi.fn(async (): Promise<JWK[]> => {
      throw new Error("down");
    });
    const t = await sign();
    for (let i = 0; i < 20; i++) expect(await verify(t, fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
let ws: string;
let n = 0;
beforeAll(async () => {
  db = await createTestDb();
  ws = (await P().workspace.create({ data: { name: "W", slug: "w-push-h" } })).id;
});
afterAll(() => db.drop());

async function mk(provider: "GMAIL" | "MICROSOFT", email = `p${++n}@x.com`) {
  return P().emailAccount.create({
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
}
async function sub(a: EmailAccount, externalId: string | null, clientState?: string) {
  return P().pushSubscription.create({
    data: {
      workspaceId: ws,
      accountId: a.id,
      provider: a.provider,
      externalId,
      clientStateHash: clientState ? sha(clientState) : null,
      expiresAt: new Date(T0.getTime() + 5 * 86_400_000),
    },
  });
}
const acct = (id: string) => P().emailAccount.findUniqueOrThrow({ where: { id } });
const gmailBody = (emailAddress: string, historyId: unknown = "5") => ({
  message: {
    data: Buffer.from(JSON.stringify({ emailAddress, historyId })).toString("base64"),
    messageId: "1",
    publishTime: T0.toISOString(),
  },
  subscription: "projects/p/subscriptions/s",
});
const graphNote = (subscriptionId: string, clientState: string, o: object = {}) => ({
  subscriptionId,
  clientState,
  changeType: "created",
  resource: "Users/x/Messages/y",
  tenantId: "t",
  ...o,
});

describe("handleGmailPush", () => {
  test("flags the GMAIL account by address (case-insensitive); cursor and watermark untouched", async () => {
    const a = await mk("GMAIL", "me@x.com");
    await sub(a, "h-1");
    const before = await acct(a.id);
    const clock = fixedClock(T0);
    expect(await handleGmailPush(P(), clock, gmailBody("Me@x.com"))).toBe(1);
    const after = await acct(a.id);
    expect(after.syncRequestedAt).toEqual(T0);
    expect(after.lastSyncCompletedAt).toEqual(before.lastSyncCompletedAt);
    expect(after.syncCursor).toEqual(before.syncCursor);
  });

  test("unknown address, a Microsoft account, or one without a live subscription → no effect", async () => {
    const m = await mk("MICROSOFT", "ms@x.com");
    await sub(m, "g-1", "cs");
    const g = await mk("GMAIL", "nosub@x.com");
    await sub(g, null);
    const clock = fixedClock(T0);
    for (const addr of ["nobody@x.com", "ms@x.com", "nosub@x.com"])
      expect(await handleGmailPush(P(), clock, gmailBody(addr))).toBe(0);
    expect((await acct(m.id)).syncRequestedAt).toBeNull();
    expect((await acct(g.id)).syncRequestedAt).toBeNull();
  });

  test("A11: the address is matched exactly (lowercased), never as a pattern", async () => {
    const a = await mk("GMAIL", "under@x.com");
    await sub(a, "h-u");
    const clock = fixedClock(T0);
    for (const addr of ["und_r@x.com", "UND_R@x.com"])
      expect(await handleGmailPush(P(), clock, gmailBody(addr))).toBe(0);
    expect((await acct(a.id)).syncRequestedAt).toBeNull();
    expect(await handleGmailPush(P(), clock, gmailBody("UNDER@x.com"))).toBe(1);
  });

  test("T00-C: the spacing floor: a fresh sync attempt blocks a flag until PUSH_MIN_GAP_SEC has passed", async () => {
    const a = await mk("GMAIL", "gap@x.com");
    await sub(a, "h-gap");
    const clock = fixedClock(T0);
    const ago = (sec: number | null) =>
      P().emailAccount.update({
        where: { id: a.id },
        data: {
          syncRequestedAt: new Date(T0.getTime() - 60_000),
          lastSyncAttemptAt: sec === null ? null : new Date(T0.getTime() - sec * 1000),
        },
      });
    await ago(1);
    expect(await handleGmailPush(P(), clock, gmailBody("gap@x.com"))).toBe(0);
    expect((await acct(a.id)).syncRequestedAt).toEqual(new Date(T0.getTime() - 60_000));
    await ago(PUSH_MIN_GAP_SEC + 1);
    expect(await handleGmailPush(P(), clock, gmailBody("gap@x.com"))).toBe(1);
    await ago(null);
    await P().emailAccount.update({ where: { id: a.id }, data: { syncRequestedAt: null } });
    expect(await handleGmailPush(P(), clock, gmailBody("gap@x.com"))).toBe(1);
  });

  test("a FAILED subscription no longer flags syncs (M4)", async () => {
    const a = await mk("GMAIL", "failed@x.com");
    const s1 = await sub(a, "h-f");
    await P().pushSubscription.update({ where: { id: s1.id }, data: { status: "FAILED" } });
    expect(await handleGmailPush(P(), fixedClock(T0), gmailBody("failed@x.com"))).toBe(0);
    expect((await acct(a.id)).syncRequestedAt).toBeNull();
  });

  test("malformed payloads are a no-op, not an error Pub/Sub would redeliver (M3)", async () => {
    const clock = fixedClock(T0);
    const bad = [
      {},
      { message: {} },
      { message: { data: "!!!" } },
      { message: { data: Buffer.from("not json").toString("base64") } },
      gmailBody("not-an-address"),
    ];
    for (const b of bad) expect(await handleGmailPush(P(), clock, b)).toBe(0);
  });
});

describe("handleGraphPush", () => {
  test("right clientState → flagged; wrong → rejected; unknown id ignored; NULL externalId never matched", async () => {
    const a = await mk("MICROSOFT");
    await sub(a, "sub-a", "secret-a");
    const nul = await mk("MICROSOFT");
    await sub(nul, null, "secret-n");
    const clock = fixedClock(T0);
    expect(await handleGraphPush(P(), clock, { value: [graphNote("sub-a", "wrong")] })).toEqual({
      flagged: 0,
      rejected: 1,
    });
    expect((await acct(a.id)).syncRequestedAt).toBeNull();
    expect(
      await handleGraphPush(P(), clock, { value: [graphNote("unknown", "secret-a")] }),
    ).toEqual({ flagged: 0, rejected: 0 });
    for (const id of ["", "null"])
      expect(
        await handleGraphPush(P(), clock, { value: [graphNote(id, "secret-n")] }).catch(() => ({
          flagged: 0,
          rejected: 0,
        })),
      ).toEqual({ flagged: 0, rejected: 0 });
    expect((await acct(nul.id)).syncRequestedAt).toBeNull();
    expect(await handleGraphPush(P(), clock, { value: [graphNote("sub-a", "secret-a")] })).toEqual({
      flagged: 1,
      rejected: 0,
    });
    expect((await acct(a.id)).syncRequestedAt).toEqual(T0);
  });

  test("T00-C: a Graph notification right after a sync attempt does not re-flag within the floor", async () => {
    const a = await mk("MICROSOFT");
    await sub(a, "sub-gap", "secret-gap");
    await P().emailAccount.update({
      where: { id: a.id },
      data: {
        syncRequestedAt: new Date(T0.getTime() - 60_000),
        lastSyncAttemptAt: new Date(T0.getTime() - 1000),
      },
    });
    const note = { value: [graphNote("sub-gap", "secret-gap")] };
    expect(await handleGraphPush(P(), fixedClock(T0), note)).toEqual({ flagged: 0, rejected: 0 });
    expect(await handleGraphPush(P(), fixedClock(new Date(T0.getTime() + 20_000)), note)).toEqual({
      flagged: 1,
      rejected: 0,
    });
  });

  test("lifecycle: subscriptionRemoved → FAILED and due; missed → flagged; a forged one changes nothing", async () => {
    const a = await mk("MICROSOFT");
    const s1 = await sub(a, "sub-l", "secret-l");
    const clock = fixedClock(T0);
    const life = (e: string, cs = "secret-l") =>
      handleGraphPush(P(), clock, {
        value: [{ subscriptionId: "sub-l", clientState: cs, lifecycleEvent: e }],
      });
    expect(await life("subscriptionRemoved", "forged")).toEqual({ flagged: 0, rejected: 1 });
    expect(await P().pushSubscription.findUniqueOrThrow({ where: { id: s1.id } })).toMatchObject({
      status: "ACTIVE",
    });
    expect(await life("missed")).toEqual({ flagged: 1, rejected: 0 });
    expect((await acct(a.id)).syncRequestedAt).toEqual(T0);
    await life("subscriptionRemoved");
    expect(await P().pushSubscription.findUniqueOrThrow({ where: { id: s1.id } })).toMatchObject({
      status: "FAILED",
      lastError: "subscriptionRemoved",
      expiresAt: T0,
    });
  });

  test("more than 100 notifications or a bad shape is a no-op, never an error (A8)", async () => {
    const clock = fixedClock(T0);
    const none = { flagged: 0, rejected: 0 };
    expect(
      await handleGraphPush(P(), clock, {
        value: Array.from({ length: 101 }, () => graphNote("x", "y")),
      }),
    ).toEqual(none);
    for (const body of [{ value: "x" }, null, "x", { value: [{ subscriptionId: 5 }] }])
      expect(await handleGraphPush(P(), clock, body)).toEqual(none);
  });
});

describe("dedupe with the watermark", () => {
  const fake = (a: { email: string }) => getFakeProvider(a.email);
  const deps = (o: Partial<SyncDeps> = {}): SyncDeps => ({
    providerFor: async (a) => fake(a),
    env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
    ...o,
  });
  /** A Gmail account with a live subscription, synced once at T0. */
  async function synced(clock: { now(): Date }) {
    const a = await mk("GMAIL");
    await sub(a, `h-${a.id}`);
    expect(await reconcileAccount(P(), clock, a.id, deps())).toBe("caught_up");
    return a;
  }
  const ranFor = (spy: ReturnType<typeof vi.fn>, a: EmailAccount) =>
    spy.mock.calls.filter(([x]) => (x as EmailAccount).id === a.id).length;

  test("1000 notifications → one flag write, one run in the tick; polling still syncs unflagged accounts", async () => {
    const clock = fixedClock(T0);
    const a = await synced(clock);
    const other = await synced(clock);
    clock.advance(20_000); // past PUSH_MIN_GAP_SEC since the sync attempt
    let flagged = 0;
    for (let i = 0; i < 20; i++) {
      const r = await Promise.all(
        Array.from({ length: 50 }, () => handleGmailPush(P(), clock, gmailBody(a.email, i))),
      );
      flagged += r.reduce((x, y) => x + y, 0);
      clock.advance(10); // later notifications would write a later value
    }
    expect(flagged).toBe(1);
    expect((await acct(a.id)).syncRequestedAt).toEqual(new Date(T0.getTime() + 20_000));
    const spy = vi.fn(async (x: EmailAccount) => fake(x) as MailProvider);
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000 });
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000, requestedOnly: true });
    expect(ranFor(spy, a)).toBe(1);
    expect(ranFor(spy, other)).toBe(0); // not flagged, poll interval not passed
    clock.advance(120_000);
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000 });
    expect(ranFor(spy, other)).toBe(1);
  });

  test("a flag during a held lease → no concurrent run, then one run right after", async () => {
    const clock = fixedClock(T0);
    const a = await synced(clock);
    clock.advance(20_000);
    await P().emailAccount.update({
      where: { id: a.id },
      data: { syncLeaseId: "other", syncLeaseUntil: new Date(clock.now().getTime() + 60_000) },
    });
    expect(await handleGmailPush(P(), clock, gmailBody(a.email))).toBe(1);
    const spy = vi.fn(async (x: EmailAccount) => fake(x) as MailProvider);
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000, requestedOnly: true });
    expect(ranFor(spy, a)).toBe(0);
    await P().emailAccount.update({
      where: { id: a.id },
      data: { syncLeaseId: null, syncLeaseUntil: null },
    });
    clock.advance(1_000);
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000, requestedOnly: true });
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000, requestedOnly: true });
    expect(ranFor(spy, a)).toBe(1);
  });

  test("a flagged account with syncErrors 3 still waits for its backoff", async () => {
    const clock = fixedClock(T0);
    const a = await synced(clock);
    await P().emailAccount.update({
      where: { id: a.id },
      data: { syncErrors: 3, syncState: "FAILED", lastSyncAttemptAt: clock.now() },
    });
    clock.advance(16_000);
    expect(await handleGmailPush(P(), clock, gmailBody(a.email))).toBe(1);
    const spy = vi.fn(async (x: EmailAccount) => fake(x) as MailProvider);
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000 });
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000, requestedOnly: true });
    expect(ranFor(spy, a)).toBe(0);
    clock.advance(480_000);
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000 });
    expect(ranFor(spy, a)).toBe(1);
  });

  test("the watermark is the run's start even when a flag arrives mid-run; another run follows", async () => {
    const clock = fixedClock(T0);
    const a = await synced(clock);
    clock.advance(20_000);
    const start = clock.now();
    const p = Object.assign(Object.create(fake(a)) as MailProvider, {
      async listChangesSince(...args: Parameters<MailProvider["listChangesSince"]>) {
        clock.advance(16_000);
        expect(await handleGmailPush(P(), clock, gmailBody(a.email))).toBe(1);
        return fake(a).listChangesSince(...args);
      },
    });
    expect(await reconcileAccount(P(), clock, a.id, deps({ providerFor: async () => p }))).toBe(
      "caught_up",
    );
    expect(await acct(a.id)).toMatchObject({
      lastSyncCompletedAt: start,
      lastSyncAttemptAt: start,
    });
    const spy = vi.fn(async (x: EmailAccount) => fake(x) as MailProvider);
    await syncDue(P(), clock, deps({ providerFor: spy }), { maxMs: 10_000, requestedOnly: true });
    expect(ranFor(spy, a)).toBe(1);
  });
});
