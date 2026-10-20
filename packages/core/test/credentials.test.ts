import { AuthError, TransientBeforeSendError, type OAuthCreds } from "@rightnow/providers";
import { createPrisma } from "@rightnow/db/create";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  accountCredentialStore,
  decryptCredentials,
  encryptCredentials,
  setCredentials,
} from "../src/accounts/credentials";
import { fixedClock } from "../src/clock";
import { seedAccount, testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
let worker: ReturnType<typeof createPrisma>; // second client = second process (web + worker)
beforeAll(async () => {
  testEnv();
  db = await createTestDb();
  worker = createPrisma(db.url, 5);
});
afterAll(async () => {
  await worker.$disconnect();
  await db.drop();
});

const stale: OAuthCreds = {
  accessToken: "at-1",
  refreshToken: "rt-1",
  expiresAt: 1,
  scope: "Mail.Send",
};
const fresh: OAuthCreds = {
  accessToken: "at-2",
  refreshToken: "rt-2",
  expiresAt: 2,
  scope: "Mail.Send",
};
let n = 0;
const seed = () =>
  seedAccount(db.prisma, encryptCredentials({ kind: "oauth", ...stale }), `a${++n}@x.com`);
const stored = async (id: string) => {
  const a = await db.prisma.emailAccount.findUniqueOrThrow({ where: { id } });
  return { ...a, creds: a.credentialsEnc && decryptCredentials(a.credentialsEnc) };
};

function gate<T>() {
  let open!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const p = new Promise<T>((res, rej) => ((open = res), (fail = rej)));
  return { p, open, fail };
}
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

function deps() {
  const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));
  const sleeps = { n: 0 };
  const sleep = async () => {
    sleeps.n++;
    await new Promise((r) => setTimeout(r, 5));
  };
  return { clock, sleep, sleeps };
}

test("two concurrent refreshes call doRefresh once and both get the rotated creds", async () => {
  const a = await seed();
  const d = deps();
  const g = gate<OAuthCreds>();
  let calls = 0;
  const doRefresh = async (c: OAuthCreds) => {
    calls++;
    expect(c).toEqual(stale);
    return g.p;
  };
  const r1 = accountCredentialStore(db.prisma, a.id, d).refresh(stale, doRefresh);
  const r2 = accountCredentialStore(worker, a.id, d).refresh(stale, doRefresh);
  await until(() => calls === 1 && d.sleeps.n > 0);
  g.open(fresh);
  expect(await Promise.all([r1, r2])).toEqual([fresh, fresh]);
  expect(calls).toBe(1);
  const s = await stored(a.id);
  expect(s.creds).toEqual({ kind: "oauth", ...fresh });
  expect(s.refreshLeaseId).toBeNull();
  expect(s.refreshLeaseUntil).toBeNull();
  expect(await accountCredentialStore(worker, a.id).get()).toEqual(fresh);
});

test("no session is idle in transaction while the token call is pending", async () => {
  const a = await seed();
  const d = deps();
  const g = gate<OAuthCreds>();
  const parked = gate<void>(); // the waiter sleeps here, between its short transactions
  let sleeps = 0;
  const sleep = async () => (sleeps++, parked.p);
  let calls = 0;
  const doRefresh = async () => (calls++, g.p);
  const r1 = accountCredentialStore(db.prisma, a.id, { ...d, sleep }).refresh(stale, doRefresh);
  const r2 = accountCredentialStore(worker, a.id, { ...d, sleep }).refresh(stale, doRefresh);
  await until(() => calls === 1 && sleeps === 1);
  const rows = await db.prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND state LIKE 'idle in transaction%'`;
  expect(rows[0]!.n).toBe(0);
  g.open(fresh);
  parked.open();
  await Promise.all([r1, r2]);
});

test("doRefresh throwing leaves creds unchanged, clears the lease, and the next caller refreshes", async () => {
  const a = await seed();
  const store = accountCredentialStore(worker, a.id, deps());
  await expect(store.refresh(stale, async () => Promise.reject(new Error("boom")))).rejects.toThrow(
    "boom",
  );
  const s = await stored(a.id);
  expect(s.creds).toEqual({ kind: "oauth", ...stale });
  expect(s.refreshLeaseId).toBeNull();
  expect(s.refreshLeaseUntil).toBeNull();
  let calls = 0;
  expect(await store.refresh(stale, async () => (calls++, fresh))).toEqual(fresh);
  expect(calls).toBe(1);
});

test("a worker that dies holding the lease blocks only until the lease expires", async () => {
  const a = await seed();
  const d = deps();
  let deadCalled = false;
  void accountCredentialStore(worker, a.id, d).refresh(stale, () => {
    deadCalled = true;
    return new Promise<OAuthCreds>(() => {}); // never completes
  });
  await until(() => deadCalled);
  expect((await stored(a.id)).refreshLeaseId).not.toBeNull();
  d.clock.advance(21_000);
  let calls = 0;
  const store = accountCredentialStore(db.prisma, a.id, d);
  expect(await store.refresh(stale, async () => (calls++, fresh))).toEqual(fresh);
  expect(calls).toBe(1);
  expect((await stored(a.id)).creds).toEqual({ kind: "oauth", ...fresh });
});

test("a token call that outlives its lease waits for the new holder instead of returning stale creds", async () => {
  const a = await seed();
  const d = deps();
  const gA = gate<OAuthCreds>();
  const gB = gate<OAuthCreds>();
  let calls = 0;
  const lateFresh: OAuthCreds = { ...fresh, accessToken: "at-late", refreshToken: "rt-late" };
  const rA = accountCredentialStore(worker, a.id, d).refresh(stale, () => (calls++, gA.p));
  await until(() => calls === 1);
  d.clock.advance(21_000); // our lease expires while the token call is still running
  const rB = accountCredentialStore(db.prisma, a.id, d).refresh(stale, () => (calls++, gB.p));
  await until(() => calls === 2);
  gA.open(lateFresh); // our conditional update matches nothing; B is still pending
  await until(() => d.sleeps.n > 0);
  gB.open(fresh);
  expect(await Promise.all([rA, rB])).toEqual([fresh, fresh]);
  expect(calls).toBe(2);
  expect((await stored(a.id)).creds).toEqual({ kind: "oauth", ...fresh });
});

test("a caller whose stale token is no longer current gets the stored creds without refreshing", async () => {
  const a = await seed();
  const store = accountCredentialStore(db.prisma, a.id, deps());
  await store.refresh(stale, async () => fresh);
  expect(await store.refresh(stale, () => Promise.reject(new Error("must not run")))).toEqual(
    fresh,
  );
});

test("refresh persists exactly what doRefresh returns (a response without refresh token keeps the old one)", async () => {
  const a = await seed();
  const kept = { ...fresh, refreshToken: stale.refreshToken };
  await accountCredentialStore(db.prisma, a.id, deps()).refresh(stale, async () => kept);
  expect((await stored(a.id)).creds).toEqual({ kind: "oauth", ...kept });
});

test("refresh finishing after disconnect does not restore tokens", async () => {
  const a = await seed();
  const g = gate<OAuthCreds>();
  let called = false;
  const r = accountCredentialStore(worker, a.id, deps()).refresh(
    stale,
    () => ((called = true), g.p),
  );
  await until(() => called);
  expect(
    await setCredentials(db.prisma, a.workspaceId, a.id, null, { status: "DISCONNECTED" }),
  ).toBe(true);
  const mid = await stored(a.id);
  expect(mid.refreshLeaseId).toBeNull();
  expect(mid.refreshLeaseUntil).toBeNull();
  expect(mid.credentialGen).toBe(1);
  g.open(fresh);
  await expect(r).rejects.toThrow(/no credentials/);
  const s = await stored(a.id);
  expect(s.credentialsEnc).toBeNull();
  expect(s.status).toBe("DISCONNECTED");
});

test("refresh finishing after reconnect does not overwrite new grant", async () => {
  const a = await seed();
  const grant: OAuthCreds = {
    accessToken: "at-new",
    refreshToken: "rt-new",
    expiresAt: 3,
    scope: "Mail.Send",
  };
  const g = gate<OAuthCreds>();
  let called = false;
  const r = accountCredentialStore(worker, a.id, deps()).refresh(
    stale,
    () => ((called = true), g.p),
  );
  await until(() => called);
  await setCredentials(db.prisma, a.workspaceId, a.id, { kind: "oauth", ...grant });
  g.open(fresh);
  expect(await r).toEqual(grant);
  expect((await stored(a.id)).creds).toEqual({ kind: "oauth", ...grant });
});

test("a refresh after soft delete fails and writes nothing", async () => {
  const a = await seed();
  await setCredentials(db.prisma, a.workspaceId, a.id, null, { deletedAt: new Date() });
  const store = accountCredentialStore(db.prisma, a.id, deps());
  await expect(store.get()).rejects.toThrow(/no credentials/);
  await expect(store.refresh(stale, async () => fresh)).rejects.toThrow(/no credentials/);
  expect((await stored(a.id)).credentialsEnc).toBeNull();
});

test("refresh failing on the old grant after reconnect returns the new grant, not AuthError", async () => {
  const a = await seed();
  const grant: OAuthCreds = {
    accessToken: "at-new",
    refreshToken: "rt-new",
    expiresAt: 3,
    scope: "Mail.Send",
  };
  const g = gate<OAuthCreds>();
  let called = false;
  const r = accountCredentialStore(worker, a.id, deps()).refresh(
    stale,
    () => ((called = true), g.p),
  );
  await until(() => called);
  await setCredentials(db.prisma, a.workspaceId, a.id, { kind: "oauth", ...grant });
  g.fail(new AuthError("invalid_grant"));
  expect(await r).toEqual(grant);
  expect((await stored(a.id)).creds).toEqual({ kind: "oauth", ...grant });
});

test("refresh failing during disconnect throws no credentials, not AuthError", async () => {
  const a = await seed();
  const g = gate<OAuthCreds>();
  let called = false;
  const r = accountCredentialStore(worker, a.id, deps()).refresh(
    stale,
    () => ((called = true), g.p),
  );
  await until(() => called);
  await setCredentials(db.prisma, a.workspaceId, a.id, null, { status: "DISCONNECTED" });
  g.fail(new AuthError("invalid_grant"));
  const err = await r.catch((e: unknown) => e);
  expect(err).not.toBeInstanceOf(AuthError);
  expect((err as Error).message).toMatch(/no credentials/);
});

test("setCredentials never writes to a soft-deleted account", async () => {
  const a = await seed();
  await setCredentials(db.prisma, a.workspaceId, a.id, null, { deletedAt: new Date() });
  const gen = (await stored(a.id)).credentialGen;
  expect(await setCredentials(db.prisma, a.workspaceId, a.id, { kind: "oauth", ...fresh })).toBe(
    false,
  );
  const s = await stored(a.id);
  expect(s.credentialsEnc).toBeNull();
  expect(s.credentialGen).toBe(gen);
});

test("setCredentials is scoped by workspace", async () => {
  const a = await seed();
  expect(await setCredentials(db.prisma, "other-ws", a.id, null)).toBe(false);
  expect((await stored(a.id)).creds).toEqual({ kind: "oauth", ...stale });
});

test("waiting on a live lease gives up after 25 s and leaves the lease alone", async () => {
  const a = await seed();
  await db.prisma.emailAccount.update({
    where: { id: a.id },
    data: { refreshLeaseId: "other", refreshLeaseUntil: new Date("2026-10-20T11:00:00Z") },
  });
  const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));
  const sleep = async (ms: number) => clock.advance(ms);
  const store = accountCredentialStore(db.prisma, a.id, { clock, sleep });
  const err = await store.refresh(stale, async () => fresh).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TransientBeforeSendError);
  expect((err as Error).message).toMatch(/lease/);
  expect((await stored(a.id)).refreshLeaseId).toBe("other");
});
