import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { PermanentSendError, buildMime, getFakeProvider } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AccountError } from "../src/accounts/service";
import { fixedClock } from "../src/clock";
import { healthInputs, healthScore } from "../src/deliverability/health";
import { placementReport, startPlacementTest } from "../src/deliverability/placement";
import { warmupTick } from "../src/deliverability/warmup";
import { reconcileAccount, type SyncDeps } from "../src/mail/sync";
import { seedCampaign } from "./campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "placement-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const fake = (a: { email: string }) => getFakeProvider(a.email);
const FAKE = { MAIL_PROVIDER_FAKE: "1" as const };
const MIN = 60_000;
const TUE_8 = new Date("2026-10-20T08:00:00Z");
const DAY0 = new Date("2026-10-20T00:00:00Z");
const renderEnv = { appUrl: "https://app.example.com", unsubscribeKeys: [Buffer.alloc(32, 1)] };
const sent: { subject: string; text: string; to: { email: string }[] }[] = [];

let n = 0;
/** Tested SMTP account `T` plus a GMAIL seed `G` and a MICROSOFT seed `M` (mail from T lands in M's spam). */
async function world(o: { cap?: number; seeds?: boolean; failM?: boolean } = {}) {
  const tag = `${++n}`;
  const s = await seedCampaign(P(), {
    at: TUE_8,
    leads: 1,
    accounts: [
      { email: `t-${tag}@sender${tag}.test`, credentialsEnc: "x", providerCap: o.cap ?? 500 },
      {
        email: `g-${tag}@gmail${tag}.test`,
        provider: "GMAIL",
        capTier: "GMAIL_WORKSPACE",
        credentialsEnc: "x",
        placementSeed: o.seeds !== false,
      },
      {
        email: `m-${tag}@ms${tag}.test`,
        provider: "MICROSOFT",
        capTier: "MS365",
        credentialsEnc: "x",
        placementSeed: o.seeds !== false,
      },
    ],
  });
  const [T, G, M] = s.accounts as [EmailAccount, EmailAccount, EmailAccount];
  await fake(T).enableDelivery();
  await fake(G).enableDelivery();
  await fake(M).enableDelivery({ spamFrom: [T.email] });
  const clock = fixedClock(TUE_8);
  const providerFor = async (a: EmailAccount) =>
    new Proxy(fake(a), {
      get: (t, k, r) =>
        k === "send"
          ? async (m: (typeof sent)[number], x: never) => {
              sent.push(m);
              if (o.failM && m.to[0]!.email === M.email) throw new PermanentSendError("550");
              return t.send(m as never, x);
            }
          : Reflect.get(t, k, r),
    });
  const deps = { providerFor, renderEnv, env: FAKE };
  const start = (input: object = { accountId: T.id }, d: object = deps) =>
    startPlacementTest(P(), clock, d as typeof deps, s.ws, null, input as never);
  const tick = () => warmupTick(P(), clock, { providerFor, env: FAKE });
  const sync = (...who: EmailAccount[]) =>
    Promise.all(
      who.map((a) =>
        reconcileAccount(P(), clock, a.id, {
          providerFor,
          env: { SYNC_POLL_SEC: 120 },
        } as unknown as SyncDeps),
      ),
    );
  await sync(T, G, M);
  return { ...s, T, G, M, clock, deps, start, tick, sync };
}
const usage = (a: EmailAccount) =>
  P().accountDailyUsage.findUnique({ where: { accountId_day: { accountId: a.id, day: DAY0 } } });
const rejects = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e as AccountError,
  );

describe("placement test (D37)", () => {
  test("reports where each seed landed, finishes after the locate, counts quota, ingests nothing", async () => {
    const w = await world();
    const { id } = await w.start();
    expect((await usage(w.T))?.sent).toBe(2);
    const rows = await P().warmupMessage.findMany({ where: { placementTestId: id } });
    expect(rows.map((r) => [r.kind, r.status, r.fromAccountId])).toEqual([
      ["PLACEMENT", "SENT", w.T.id],
      ["PLACEMENT", "SENT", w.T.id],
    ]);

    const pending = await placementReport(P(), w.ws, id);
    expect(pending.seeds.map((x) => x.folder)).toEqual(["PENDING", "PENDING"]);

    await w.sync(w.T, w.G, w.M); // sync sees the INBOX copy and the Sent copy, and stores neither
    expect(await P().message.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().thread.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().event.count({ where: { workspaceId: w.ws, type: { not: "ACCEPTED" } } })).toBe(
      0,
    );

    w.clock.advance(10 * MIN);
    await w.tick();
    const r = await placementReport(P(), w.ws, id);
    expect(r.seeds.map((x) => ({ esp: x.esp, folder: x.folder }))).toEqual([
      { esp: "Gmail", folder: "INBOX" },
      { esp: "Microsoft", folder: "SPAM" },
    ]);
    expect(r).toMatchObject({ accountId: w.T.id, spamAssassin: "not provided" });
    expect(
      (await P().placementTest.findUniqueOrThrow({ where: { id } })).finishedAt,
    ).not.toBeNull();

    const inputs = (await healthInputs(P(), [w.T.id], w.clock.now())).get(w.T.id)!;
    expect(inputs.placement).toEqual({ inbox: 1, total: 2 });
    expect(healthScore({ ...inputs, placement: null }) - healthScore(inputs)).toBe(10);
  });

  test("the message is the rendered variant with no tracking or unsubscribe link (Rev 2 I8)", async () => {
    const w = await world();
    sent.length = 0;
    await w.start({ accountId: w.T.id, variantId: w.steps[0]!.variant.id });
    expect(sent).toHaveLength(2);
    for (const m of sent) {
      const raw = (await buildMime(m as never)).toString();
      expect(m.subject).toBe("Hi");
      expect(raw).toContain("unsubscribe disabled in test emails");
      expect(raw).not.toMatch(/\/[tu]\//);
      expect(raw.toLowerCase()).not.toContain("list-unsubscribe");
    }
  });

  test("a given subject and body are sent as is", async () => {
    const w = await world();
    sent.length = 0;
    await w.start({ accountId: w.T.id, subject: "Hello there", body: "Plain body" });
    expect(sent[0]).toMatchObject({ subject: "Hello there", text: "Plain body" });
  });

  test("no seeds: 409 no_seeds, nothing sent or counted", async () => {
    const w = await world({ seeds: false });
    const e = await rejects(w.start());
    expect([e?.status, e?.message]).toEqual([409, "no_seeds"]);
    expect(await P().placementTest.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await usage(w.T)).toBeNull();
  });

  test("at floor(providerCap/2): 409 provider_cap and nothing is written", async () => {
    const w = await world({ cap: 4 }); // cap 2
    await P().accountDailyUsage.create({ data: { accountId: w.T.id, day: DAY0, sent: 1 } });
    const e = await rejects(w.start());
    expect([e?.status, e?.message]).toEqual([409, "provider_cap"]);
    expect((await usage(w.T))?.sent).toBe(1);
    expect(await P().placementTest.count({ where: { workspaceId: w.ws } })).toBe(0);
    expect(await P().warmupMessage.count({ where: { workspaceId: w.ws } })).toBe(0);
  });

  test("two concurrent tests at the cap: exactly one succeeds (M10)", async () => {
    const w = await world({ cap: 10 }); // cap 5, 3 used: one test (2 units) fits, two do not
    await P().accountDailyUsage.create({ data: { accountId: w.T.id, day: DAY0, sent: 3 } });
    const r = await Promise.allSettled([w.start(), w.start()]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason.message).toBe("provider_cap");
    expect((await usage(w.T))?.sent).toBe(5);
  });

  test("an unverified provider (no ProviderVerification, no Fake) is 409 account_unavailable and sends nothing (Rev 2 I7)", async () => {
    const w = await world();
    sent.length = 0;
    const e = await rejects(w.start({ accountId: w.T.id }, { ...w.deps, env: {} }));
    expect([e?.status, e?.message]).toEqual([409, "account_unavailable"]);
    // the tested SMTP account verified, the seeds' providers not: nobody to send to
    await P().providerVerification.create({
      data: { provider: "SMTP", passedAt: TUE_8, accountId: w.T.id, report: {} },
    });
    const e2 = await rejects(w.start({ accountId: w.T.id }, { ...w.deps, env: {} }));
    expect(e2?.message).toBe("no_seeds");
    expect(sent).toHaveLength(0);
    await P().providerVerification.deleteMany({});
  });

  test("a missing account is 404; a paused one is account_unavailable", async () => {
    const w = await world();
    expect((await rejects(w.start({ accountId: "nope" })))?.status).toBe(404);
    await P().emailAccount.update({ where: { id: w.T.id }, data: { lifecycle: "PAUSED" } });
    expect((await rejects(w.start()))?.message).toBe("account_unavailable");
  });

  test("a failed send is reported MISSING and the test still finishes", async () => {
    const w = await world({ failM: true });
    const { id } = await w.start();
    w.clock.advance(10 * MIN);
    await w.tick();
    const r = await placementReport(P(), w.ws, id);
    expect(r.seeds.map((x) => x.folder)).toEqual(["INBOX", "MISSING"]);
    expect(
      await P().warmupMessage.count({ where: { placementTestId: id, status: "FAILED" } }),
    ).toBe(1);
    expect(
      (await P().placementTest.findUniqueOrThrow({ where: { id } })).finishedAt,
    ).not.toBeNull();
  });
});

describe("placement test failure paths and scoping (fix round 1)", () => {
  test("providerFor throwing fails every row at once: seeds MISSING, test finishes, no health penalty", async () => {
    const w = await world();
    const e = new Error("decrypt");
    const { id } = await w.start(
      { accountId: w.T.id },
      {
        ...w.deps,
        providerFor: async () => {
          throw e;
        },
      },
    );
    expect(
      await P().warmupMessage.count({ where: { placementTestId: id, status: "FAILED" } }),
    ).toBe(2);
    expect((await placementReport(P(), w.ws, id)).seeds.map((x) => x.folder)).toEqual([
      "MISSING",
      "MISSING",
    ]);
    await w.tick();
    expect(
      (await P().placementTest.findUniqueOrThrow({ where: { id } })).finishedAt,
    ).not.toBeNull();
    expect((await healthInputs(P(), [w.T.id], w.clock.now())).get(w.T.id)!.placement).toBeNull();
  });

  test("failed sends are not placement misses in the health term", async () => {
    const w = await world({ failM: true });
    await w.start();
    w.clock.advance(10 * MIN);
    await w.tick();
    expect((await healthInputs(P(), [w.T.id], w.clock.now())).get(w.T.id)!.placement).toEqual({
      inbox: 1,
      total: 1,
    });
  });

  test("a seed that becomes unlocatable is MISSING after 24 h and the test finishes", async () => {
    const w = await world();
    const { id } = await w.start();
    await P().emailAccount.update({
      where: { id: w.M.id },
      data: { lifecycle: "NEEDS_ATTENTION" },
    });
    w.clock.advance(10 * MIN);
    await w.tick();
    expect((await P().placementTest.findUniqueOrThrow({ where: { id } })).finishedAt).toBeNull();
    expect((await placementReport(P(), w.ws, id)).seeds.map((x) => x.folder)).toEqual([
      "INBOX",
      "PENDING",
    ]);
    w.clock.advance(24 * 60 * MIN);
    await w.tick();
    expect((await placementReport(P(), w.ws, id)).seeds.map((x) => x.folder)).toEqual([
      "INBOX",
      "MISSING",
    ]);
    expect(
      (await P().placementTest.findUniqueOrThrow({ where: { id } })).finishedAt,
    ).not.toBeNull();
  });

  test("seeds of another workspace and NEEDS_ATTENTION seeds are skipped; a foreign variant is 404", async () => {
    const w = await world();
    const other = await world(); // its seeds live in another workspace
    await P().emailAccount.update({
      where: { id: w.G.id },
      data: { lifecycle: "NEEDS_ATTENTION" },
    });
    const { id } = await w.start();
    expect((await placementReport(P(), w.ws, id)).seeds.map((x) => x.accountId)).toEqual([w.M.id]);
    expect(
      await P().warmupMessage.count({ where: { toAccountId: { in: [other.G.id, other.M.id] } } }),
    ).toBe(0);
    const e = await rejects(w.start({ accountId: w.T.id, variantId: other.steps[0]!.variant.id }));
    expect(e?.status).toBe(404);
  });

  test("placementReport does not resolve a test of another workspace", async () => {
    const w = await world();
    const other = await world();
    const { id } = await w.start();
    expect((await rejects(placementReport(P(), other.ws, id)))?.status).toBe(404);
  });
});
