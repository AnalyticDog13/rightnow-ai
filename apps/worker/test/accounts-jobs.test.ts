import { fixedClock } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import type { MailProvider } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { accountsAutoResume } from "../src/jobs/accounts-auto-resume";
import { accountsAutofix } from "../src/jobs/accounts-autofix";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let n = 0;
const T0 = new Date("2026-10-20T10:00:00Z");
const min = (m: number) => new Date(T0.getTime() + m * 60_000);
beforeAll(async () => {
  db = await createTestDb();
  ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w-jobs" } })).id;
});
afterAll(() => db.drop());

const mk = (data: Record<string, unknown> = {}) =>
  db.prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "GMAIL",
      email: `j${++n}@acme.io`,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: "GMAIL_WORKSPACE",
      providerCap: 1500,
      credentialsEnc: "enc",
      ...data,
    },
  });
const get = (id: string) => db.prisma.emailAccount.findUniqueOrThrow({ where: { id } });

describe("accountsAutoResume", () => {
  test("resumes only once the time has come; a manual pause is never resumed", async () => {
    const timed = await mk({ lifecycle: "PAUSED", pausedUntil: min(30) });
    const manual = await mk({ lifecycle: "PAUSED" });
    const clock = fixedClock(T0);
    await accountsAutoResume(db.prisma, clock);
    expect((await get(timed.id)).lifecycle).toBe("PAUSED");
    clock.advance(30 * 60_000);
    await accountsAutoResume(db.prisma, clock);
    expect(await get(timed.id)).toMatchObject({ lifecycle: "ACTIVE", pausedUntil: null });
    expect((await get(manual.id)).lifecycle).toBe("PAUSED");
  });

  test("a timed pause ends through returnToService: a re-warm plan resumes as REWARMING (Rev 2 I2)", async () => {
    const a = await mk({
      lifecycle: "PAUSED",
      pausedUntil: min(-1),
      rewarmStartedAt: min(-3 * 24 * 60),
      healthCap: 4,
    });
    await accountsAutoResume(db.prisma, fixedClock(T0));
    expect(await get(a.id)).toMatchObject({ lifecycle: "REWARMING", pausedUntil: null, healthResetAt: T0 });
  });

  test("purges OAuth sessions older than one day, keeps newer ones", async () => {
    const mkSession = (hash: string, createdAt: Date) =>
      db.prisma.oAuthSession.create({
        data: {
          workspaceId: ws,
          createdByUserId: "u",
          provider: "GMAIL",
          stateHash: hash,
          codeVerifierEnc: "v",
          expiresAt: createdAt,
          createdAt,
        },
      });
    await mkSession("old", new Date(T0.getTime() - 25 * 3600_000));
    await mkSession("new", new Date(T0.getTime() - 23 * 3600_000));
    await accountsAutoResume(db.prisma, fixedClock(T0));
    const left = await db.prisma.oAuthSession.findMany({ where: { workspaceId: ws } });
    expect(left.map((s) => s.stateHash)).toEqual(["new"]);
  });
});

describe("accountsAutofix", () => {
  const providerFor = (ok: boolean) => () =>
    ({
      diagnostics: async () => ({
        ok,
        checks: [{ name: "token", ok, code: ok ? undefined : "api_down" }],
      }),
    }) as unknown as MailProvider;
  const broken = (code: string, extra: Record<string, unknown> = {}) =>
    mk({ status: "ERROR", lastError: { kind: "CONNECTION", code }, ...extra });

  test("healthy diagnostics reconnect the account; failing ones mark FAILED", async () => {
    const a = await broken("network");
    await accountsAutofix(db.prisma, fixedClock(T0), providerFor(true));
    expect(await get(a.id)).toMatchObject({
      status: "CONNECTED",
      autofixState: "SUCCEEDED",
      lastError: null,
    });
    const c = await broken("network");
    await accountsAutofix(db.prisma, fixedClock(T0), providerFor(false));
    expect(await get(c.id)).toMatchObject({ status: "ERROR", autofixState: "FAILED" });
  });

  test("not retried within 15 minutes; auth errors never autofixed", async () => {
    const a = await broken("network");
    const auth = await broken("invalid_grant");
    const scope = await broken("scope_missing");
    const attention = await broken("network", { lifecycle: "NEEDS_ATTENTION" });
    await accountsAutofix(db.prisma, fixedClock(min(100)), providerFor(false));
    expect((await get(a.id)).autofixState).toBe("FAILED");
    await accountsAutofix(db.prisma, fixedClock(min(110)), providerFor(true));
    expect((await get(a.id)).autofixState).toBe("FAILED");
    await accountsAutofix(db.prisma, fixedClock(min(116)), providerFor(true));
    expect((await get(a.id)).autofixState).toBe("SUCCEEDED");
    for (const x of [auth, scope, attention]) expect((await get(x.id)).autofixState).toBe("NONE");
  });
});

test("a disconnect during autofix stays disconnected", async () => {
  const a = await mk({ status: "ERROR", lastError: { kind: "CONNECTION", code: "network" } });
  const providerFor = () =>
    ({
      diagnostics: async () => {
        // the user disconnects while the check runs
        await db.prisma.emailAccount.update({
          where: { id: a.id },
          data: { status: "DISCONNECTED", credentialsEnc: null, credentialGen: { increment: 1 } },
        });
        return { ok: true, checks: [{ name: "token", ok: true }] };
      },
    }) as unknown as MailProvider;
  await accountsAutofix(db.prisma, fixedClock(new Date("2026-11-01T00:00:00Z")), providerFor);
  expect(await get(a.id)).toMatchObject({ status: "DISCONNECTED", credentialsEnc: null });
});
