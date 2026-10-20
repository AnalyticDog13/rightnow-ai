import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectIsolated, createTestDb } from "@rightnow/db/test-db";
import type { CapTier } from "@rightnow/db/client";
import {
  AuthError,
  PermanentSendError,
  RateLimitedError,
  TransientBeforeSendError,
  getFakeProvider,
  type Diagnostics,
  type MailProvider,
} from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { encryptCredentials } from "../src/accounts/credentials";
import { markFixed, runDiagnostics } from "../src/accounts/diagnostics";
import { dayKey } from "../src/accounts/daykey";
import { recordProviderError } from "../src/accounts/health";
import { toApiAccount } from "../src/accounts/serialize";
import {
  bulkApply,
  disconnectAccount,
  getAccount,
  listAccounts,
  pauseAccount,
  resumeAccount,
  softDeleteAccount,
  updateAccount,
} from "../src/accounts/service";
import { displayStatus } from "../src/accounts/status";
import { verifyCname } from "../src/accounts/tracking-domain";
import { fixedClock } from "../src/clock";
import { resetEnvCache } from "../src/env";
import { testEnv } from "./accounts-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
const T0 = new Date("2026-10-20T10:00:00Z");
const clock = fixedClock(T0);
const creds = () =>
  encryptCredentials({
    kind: "oauth",
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: 1,
    scope: "s",
  });
let n = 0;

beforeAll(async () => {
  testEnv();
  process.env.MAIL_PROVIDER_FAKE = "1";
  process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "rn-svc-"));
  resetEnvCache();
  db = await createTestDb();
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w-svc" } })).id;
});
afterAll(() => db.drop());

const TIERS: Record<CapTier, [string, "GMAIL" | "MICROSOFT" | "SMTP", number, number]> = {
  GMAIL_WORKSPACE: ["acme.io", "GMAIL", 1500, 750],
  GMAIL_CONSUMER: ["gmail.com", "GMAIL", 400, 200],
  MS365: ["acme.io", "MICROSOFT", 5000, 2500],
  OUTLOOK_COM: ["outlook.com", "MICROSOFT", 250, 125],
  SMTP: ["acme.io", "SMTP", 100, 50],
};
async function mk(over: Record<string, unknown> = {}, tier: CapTier = "GMAIL_WORKSPACE") {
  const [domain, provider, cap] = TIERS[tier];
  return db.prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider,
      email: `u${++n}@${domain}`,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: tier,
      providerCap: cap,
      credentialsEnc: creds(),
      ...over,
    },
  });
}
const o = { clock, actorId: "u1", role: "ADMIN" as const };
const foreign = "ws_other";
const notFound = { status: 404 };

describe("limits", () => {
  test.each(Object.entries(TIERS))(
    "%s clamps dailyLimit to half the provider cap",
    async (tier, [, , , max]) => {
      const a = await mk({}, tier as CapTier);
      expect(a.dailyLimit).toBe(30);
      const r = await updateAccount(db.prisma, ws, a.id, { dailyLimit: 99999 }, o);
      expect(r.account.dailyLimit).toBe(max);
      expect(r.warnings[0]).toEqual({
        field: "dailyLimit",
        clampedTo: max,
        reason: "provider_cap",
      });
    },
  );

  test("providerCap is clamped to the settable max; dailyLimit follows", async () => {
    const a = await mk();
    const r = await updateAccount(db.prisma, ws, a.id, { providerCap: 99999 }, o);
    expect(r.account.providerCap).toBe(2000);
    expect(r.warnings[0]).toMatchObject({ field: "providerCap", clampedTo: 2000 });
    const low = await updateAccount(db.prisma, ws, a.id, { providerCap: 20, dailyLimit: 30 }, o);
    expect(low.account.dailyLimit).toBe(10);
  });

  test("minGapSec: 86400 ok, 86401 rejected, MS365 floor 3 with a warning", async () => {
    const a = await mk();
    const r1 = await updateAccount(db.prisma, ws, a.id, { minGapSec: 86400 }, o);
    expect(r1.account.minGapSec).toBe(86400);
    await expect(updateAccount(db.prisma, ws, a.id, { minGapSec: 86401 }, o)).rejects.toThrow();
    const m = await mk({}, "MS365");
    const r = await updateAccount(db.prisma, ws, m.id, { minGapSec: 0 }, o);
    expect(r.account.minGapSec).toBe(3);
    expect(r.warnings).toEqual([{ field: "minGapSec", clampedTo: 3, reason: "provider_min_gap" }]);
  });

  test("unknown properties are rejected", async () => {
    const a = await mk();
    await expect(
      updateAccount(db.prisma, ws, a.id, { credentialsEnc: "x" } as never, o),
    ).rejects.toThrow();
  });

  test("a foreign workspace cannot update", async () => {
    const a = await mk();
    await expect(
      updateAccount(db.prisma, foreign, a.id, { fromName: "x" }, o),
    ).rejects.toMatchObject(notFound);
  });
});

describe("displayStatus", () => {
  const base = { status: "CONNECTED", lifecycle: "ACTIVE", pausedUntil: null, lastError: null };
  const row = (over: object) => displayStatus({ ...base, ...over } as never, T0);
  const later = new Date(T0.getTime() + 1000);
  const earlier = new Date(T0.getTime() - 1000);
  test.each([
    [{}, "ACTIVE"],
    [{ lifecycle: "PAUSED" }, "PAUSED"],
    [{ lifecycle: "PAUSED", pausedUntil: later }, "TEMP_PAUSED"],
    [{ lifecycle: "PAUSED", pausedUntil: earlier }, "PAUSED"],
    [{ status: "ERROR", lastError: { kind: "CONNECTION" } }, "CONNECTION_ERROR"],
    [{ lastError: { kind: "SOFT_BOUNCE" } }, "SOFT_BOUNCE_ERROR"],
    [{ lastError: { kind: "SENDING" } }, "SENDING_ERROR"],
    [{ lifecycle: "REWARMING" }, "REWARMING"],
    [{ lifecycle: "INACTIVE" }, "INACTIVE"],
    [
      { status: "ERROR", lifecycle: "NEEDS_ATTENTION", lastError: { kind: "CONNECTION" } },
      "NEEDS_ATTENTION",
    ],
  ])("%j -> %s", (over, want) => expect(row(over)).toBe(want));
});

describe("toApiAccount", () => {
  test("remainingToday from usage; the day key follows the account timezone", async () => {
    const a = await mk({ timezone: "Pacific/Auckland" });
    expect(dayKey("Pacific/Auckland", new Date("2026-03-01T12:00:00Z"))).toBe("2026-03-02");
    expect(dayKey("UTC", new Date("2026-03-01T12:00:00Z"))).toBe("2026-03-01");
    const v = toApiAccount(a, { sent: 4, reserved: 1 }, T0);
    expect(v).toMatchObject({
      sentToday: 4,
      reservedToday: 1,
      remainingToday: 25,
      displayStatus: "ACTIVE",
    });
    await db.prisma.accountDailyUsage.create({
      data: {
        accountId: a.id,
        day: new Date(`${dayKey("Pacific/Auckland", T0)}T00:00:00Z`),
        sent: 4,
        reserved: 1,
      },
    });
    expect((await getAccount(db.prisma, ws, a.id, o))!.remainingToday).toBe(25);
    expect(await getAccount(db.prisma, ws, "nope", o)).toBeNull();
  });
});

describe("recordProviderError", () => {
  test("AuthError needs attention; transient errors change nothing; resume says reconnect first", async () => {
    const a = await mk();
    await recordProviderError(db.prisma, clock, a.id, new TransientBeforeSendError("x"));
    await recordProviderError(db.prisma, clock, a.id, new RateLimitedError(5));
    expect(await db.prisma.emailAccount.findUnique({ where: { id: a.id } })).toMatchObject({
      status: "CONNECTED",
      errorCount24h: 0,
      lastError: null,
    });
    await recordProviderError(db.prisma, clock, a.id, new AuthError("invalid_grant"));
    expect(await db.prisma.emailAccount.findUnique({ where: { id: a.id } })).toMatchObject({
      status: "ERROR",
      lifecycle: "NEEDS_ATTENTION",
      lastError: { kind: "CONNECTION", code: "invalid_grant" },
      errorCount24h: 1,
    });
    await expect(resumeAccount(db.prisma, ws, a.id, o)).rejects.toMatchObject({
      status: 409,
      message: "reconnect or mark as fixed first",
    });
    const p = await mk();
    await recordProviderError(db.prisma, clock, p.id, new PermanentSendError("rejected"));
    const row = await db.prisma.emailAccount.findUnique({ where: { id: p.id } });
    expect(row!.lastError).toMatchObject({ kind: "SENDING", code: "rejected" });
  });
});

describe("pause / resume", () => {
  test("pause is immediate; until sets pausedUntil; resume clears it; audited with the actor", async () => {
    const a = await mk();
    expect((await pauseAccount(db.prisma, ws, a.id, undefined, o)).lifecycle).toBe("PAUSED");
    const until = new Date(T0.getTime() + 3600_000);
    expect((await pauseAccount(db.prisma, ws, a.id, until, o)).pausedUntil).toEqual(until);
    await expect(
      pauseAccount(db.prisma, ws, a.id, new Date(T0.getTime() - 1), o),
    ).rejects.toMatchObject({ status: 400 });
    expect((await resumeAccount(db.prisma, ws, a.id, o)).lifecycle).toBe("ACTIVE");
    const acts = await db.prisma.auditLog.findMany({
      where: { target: a.id },
      orderBy: { createdAt: "asc" },
    });
    expect(acts.map((x) => x.action)).toEqual(["account.pause", "account.pause", "account.resume"]);
    expect(acts[0]!.actorId).toBe("u1");
    await expect(pauseAccount(db.prisma, foreign, a.id, undefined, o)).rejects.toMatchObject(
      notFound,
    );
    await expect(resumeAccount(db.prisma, foreign, a.id, o)).rejects.toMatchObject(notFound);
  });
});

describe("disconnect and delete", () => {
  const stub = (revoke: () => Promise<void>) => ({
    providerFor: () => ({ revoke }) as unknown as MailProvider,
  });
  test("disconnect revokes once, drops credentials, keeps the row and cursor", async () => {
    const a = await mk({ syncCursor: { kind: "fake", epoch: 1, seq: 2 } });
    const revoke = vi.fn(async () => {});
    const r = await disconnectAccount(db.prisma, ws, a.id, { ...o, ...stub(revoke) });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(r.revoked).toBe(true);
    const row = (await db.prisma.emailAccount.findUnique({ where: { id: a.id } }))!;
    expect(row).toMatchObject({
      credentialsEnc: null,
      status: "DISCONNECTED",
      lifecycle: "PAUSED",
      syncCursor: { kind: "fake", epoch: 1, seq: 2 },
    });
    const n1 = await db.prisma.auditLog.count({
      where: { target: a.id, action: "account.disconnect" },
    });
    expect(n1).toBe(1);
    await expect(resumeAccount(db.prisma, ws, a.id, o)).rejects.toMatchObject({ status: 409 });
  });
  test("a failing revoke still disconnects", async () => {
    const a = await mk();
    const r = await disconnectAccount(db.prisma, ws, a.id, {
      ...o,
      ...stub(async () => {
        throw new Error("boom");
      }),
    });
    expect(r.revoked).toBe(false);
    expect(
      (await db.prisma.emailAccount.findUnique({ where: { id: a.id } }))!.credentialsEnc,
    ).toBeNull();
  });
  test("soft delete purges credentials, hides the row, keeps usage", async () => {
    const a = await mk();
    await db.prisma.accountDailyUsage.create({
      data: { accountId: a.id, day: new Date("2026-10-20"), sent: 1 },
    });
    await softDeleteAccount(db.prisma, ws, a.id, { ...o, ...stub(async () => {}) });
    const row = (await db.prisma.emailAccount.findUnique({ where: { id: a.id } }))!;
    expect(row.deletedAt).not.toBeNull();
    expect(row.credentialsEnc).toBeNull();
    const ids = async (q: object) =>
      (await listAccounts(db.prisma, ws, q, o)).accounts.map((x) => x.id);
    expect(await ids({})).not.toContain(a.id);
    expect(await ids({ includeDeleted: true })).toContain(a.id);
    expect(await db.prisma.accountDailyUsage.count({ where: { accountId: a.id } })).toBe(1);
    await expect(softDeleteAccount(db.prisma, ws, a.id, o)).rejects.toMatchObject(notFound);
  });
  test("a foreign workspace is not found", async () => {
    const a = await mk();
    await expect(disconnectAccount(db.prisma, foreign, a.id, o)).rejects.toMatchObject(notFound);
    await expect(softDeleteAccount(db.prisma, foreign, a.id, o)).rejects.toMatchObject(notFound);
  });
});

describe("diagnostics and mark fixed", () => {
  const diag = (d: Diagnostics) => ({
    providerFor: () => ({ diagnostics: async () => d }) as unknown as MailProvider,
  });
  const bad: Diagnostics = {
    ok: false,
    checks: [
      {
        name: "token",
        ok: false,
        code: "invalid_grant",
        command: "refresh",
        response: "x".repeat(500),
        message: "m",
      },
    ],
  };
  test("failing checks are stored as lastError, responses truncated to 200 chars", async () => {
    const a = await mk();
    const r = await runDiagnostics(db.prisma, ws, a.id, { ...o, ...diag(bad) });
    expect(r.dns).toBeNull();
    expect(r.checks[0]!.response).toHaveLength(200);
    const row = (await db.prisma.emailAccount.findUnique({ where: { id: a.id } }))!;
    expect(row.lastError).toMatchObject({
      kind: "CONNECTION",
      code: "invalid_grant",
      command: "refresh",
      message: "m",
    });
    expect((row.lastError as { response: string }).response).toHaveLength(200);
    await expect(runDiagnostics(db.prisma, foreign, a.id, o)).rejects.toMatchObject(notFound);
  });
  test("markFixed: 409 with the diagnostics body while the token check fails; a user pause stays", async () => {
    const a = await mk({
      status: "ERROR",
      lifecycle: "NEEDS_ATTENTION",
      lastError: { kind: "CONNECTION", code: "invalid_grant" },
    });
    await expect(markFixed(db.prisma, ws, a.id, { ...o, ...diag(bad) })).rejects.toMatchObject({
      status: 409,
      body: { ok: false },
    });
    const good = diag({ ok: true, checks: [{ name: "token", ok: true }] });
    expect(await markFixed(db.prisma, ws, a.id, { ...o, ...good })).toMatchObject({
      status: "CONNECTED",
      lifecycle: "ACTIVE",
      lastError: null,
    });
    const p = await mk({
      status: "ERROR",
      lifecycle: "PAUSED",
      lastError: { kind: "CONNECTION", code: "x" },
    });
    expect(await markFixed(db.prisma, ws, p.id, { ...o, ...good })).toMatchObject({
      status: "CONNECTED",
      lifecycle: "PAUSED",
    });
    const n1 = await db.prisma.auditLog.count({
      where: { target: a.id, action: "account.mark_fixed" },
    });
    expect(n1).toBe(1);
  });
  test("the Fake provider reports a revoked grant", async () => {
    const a = await mk({ email: "revoked@fake.test" });
    getFakeProvider(a.email, "GMAIL").failNext("auth_revoked");
    const r = await runDiagnostics(db.prisma, ws, a.id, o);
    expect(r.ok).toBe(false);
    getFakeProvider(a.email, "GMAIL").clearFailures();
  });
});

describe("tracking domain", () => {
  test("verifyCname", async () => {
    const ok = async () => ["app.example.com."];
    expect(await verifyCname("track.acme.test", "app.example.com", ok)).toBe("VERIFIED");
    const other = async () => ["other.example.com"];
    expect(await verifyCname("track.acme.test", "app.example.com", other)).toBe("FAILED");
    const nx = async () => {
      throw Object.assign(new Error("x"), { code: "ENOTFOUND" });
    };
    expect(await verifyCname("track.acme.test", "app.example.com", nx)).toBe("FAILED");
  });
  test("update verifies via the resolver; skipCnameCheck needs ADMIN and is audited", async () => {
    const a = await mk();
    const good = async () => ["localhost"]; // APP_URL host
    const bad = async () => ["elsewhere.test"];
    const set = (patch: object, extra: object) =>
      updateAccount(db.prisma, ws, a.id, patch, { ...o, ...extra });
    const r1 = await set({ trackingDomain: "track.acme.test" }, { resolveCname: good });
    expect(r1.account.trackingDomainStatus).toBe("VERIFIED");
    const r2 = await set({ trackingDomain: "t2.acme.test" }, { resolveCname: bad });
    expect(r2.account.trackingDomainStatus).toBe("FAILED");
    const skip = { trackingDomain: "t3.acme.test", skipCnameCheck: true };
    await expect(set(skip, { role: "MEMBER", resolveCname: bad })).rejects.toMatchObject({
      status: 403,
    });
    const r3 = await set(skip, { resolveCname: bad });
    expect(r3.account.trackingDomainStatus).toBe("VERIFIED");
    const logged = await db.prisma.auditLog.findMany({
      where: { target: a.id, action: "account.update" },
    });
    expect(logged.some((l) => JSON.stringify(l.meta).includes("skipCnameCheck"))).toBe(true);
  });
});

describe("bulkApply", () => {
  test("applies to owned ids only, one audit row per account per action", async () => {
    const [a, b] = [await mk(), await mk()];
    const other = await db.prisma.workspace.create({ data: { name: "O", slug: "w-other" } });
    const f = await mk({ workspaceId: other.id });
    const res = await bulkApply(
      db.prisma,
      ws,
      { ids: [a.id, b.id, f.id], action: "set_signature", value: "Best, F" },
      o,
    );
    expect(res).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: true },
      { id: f.id, ok: false, error: "not_found" },
    ]);
    const get = (id: string) => db.prisma.emailAccount.findUnique({ where: { id } });
    expect((await get(f.id))!.signature).toBeNull();
    expect((await get(b.id))!.signature).toBe("Best, F");
    await bulkApply(db.prisma, ws, { ids: [a.id, b.id], action: "add_tags", value: ["x", "y"] }, o);
    await bulkApply(db.prisma, ws, { ids: [a.id], action: "remove_tags", value: ["x"] }, o);
    expect((await get(a.id))!.tags).toEqual(["y"]);
    expect((await get(b.id))!.tags).toEqual(["x", "y"]);
    await bulkApply(db.prisma, ws, { ids: [a.id, b.id], action: "pause" }, o);
    await bulkApply(db.prisma, ws, { ids: [a.id, b.id], action: "set_daily_limit", value: 5 }, o);
    expect((await get(b.id))!.dailyLimit).toBe(5);
    const count = (id: string, action: string) =>
      db.prisma.auditLog.count({ where: { target: id, action } });
    expect(await count(a.id, "account.pause")).toBe(1);
    const providerFor = () => ({ revoke: async () => {} }) as unknown as MailProvider;
    await bulkApply(db.prisma, ws, { ids: [a.id], action: "delete" }, { ...o, providerFor });
    expect((await get(a.id))!.deletedAt).not.toBeNull();
    expect(await count(a.id, "account.delete")).toBe(1);
  });
  test("more than 200 ids is rejected", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id${i}`);
    await expect(bulkApply(db.prisma, ws, { ids, action: "pause" }, o)).rejects.toThrow();
  });
});

test("listAccounts is workspace-scoped", async () => {
  await expectIsolated({
    prisma: db.prisma,
    seed: (w) => mk({ workspaceId: w }),
    read: async (w) => (await listAccounts(db.prisma, w, {}, o)).accounts,
  });
});
