import { randomBytes } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import type { EventType, PrismaClient } from "@rightnow/db/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { optimizeVariants, zScore } from "../src/campaigns/ab";
import { campaignPatchSchema } from "../src/campaigns/schema";
import { getSequence, updateVariant } from "../src/campaigns/sequence";
import { fixedClock } from "../src/clock";
import { planDue } from "../src/planner";
import { unsubscribeKeys } from "../src/unsubscribe";
import { testEnv } from "./accounts-fixture";
import { markFresh, seedCampaign } from "./campaign-fixture";

const T = new Date("2026-10-20T10:00:00Z");
let db: Awaited<ReturnType<typeof createTestDb>>;
const P = (): PrismaClient => db.prisma;
beforeEach(async () => {
  testEnv();
  db = await createTestDb();
});
afterEach(() => db.drop());

type Seeded = Awaited<ReturnType<typeof seedCampaign>>;
let seq = 0;
/** n ACCEPTED events (one per lead) for the variant, the first k of those leads also carrying `type`. */
async function seed(
  s: Seeded,
  variantId: string,
  n: number,
  k: number,
  type: EventType = "REPLY",
  meta: object = {},
) {
  const base = { workspaceId: s.ws, campaignId: s.campaign.id, stepId: s.steps[0]!.id, variantId };
  const tag = `${variantId}:${seq++}`;
  await P().event.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      ...base,
      type: "ACCEPTED" as const,
      occurredAt: T,
      leadId: `${tag}:${i}`,
      dedupeKey: `${tag}:a:${i}`,
    })),
  });
  await P().event.createMany({
    data: Array.from({ length: k }, (_, i) => ({
      ...base,
      type,
      occurredAt: T,
      leadId: `${tag}:${i}`,
      dedupeKey: `${tag}:r:${i}`,
      meta,
    })),
  });
}

/** A campaign with variant A and one variant per extra label, auto-optimize on. */
async function setup(extra: string[] = ["B"], campaign: object = {}, leads = 0) {
  const s = await seedCampaign(P(), {
    at: T,
    leads,
    accounts: [{ dailyLimit: 100 }],
    campaign: { abAutoOptimize: true, ...campaign },
  });
  const v: Record<string, { id: string }> = { A: s.steps[0]!.variant };
  for (const label of extra)
    v[label] = await P().stepVariant.create({
      data: { stepId: s.steps[0]!.id, label, subject: label, body: label },
    });
  return { s, v };
}
const run = () => optimizeVariants(P(), fixedClock(T));
const active = async (stepId: string) =>
  (
    await P().stepVariant.findMany({ where: { stepId, active: true }, orderBy: { label: "asc" } })
  ).map((v) => v.label);

describe("zScore", () => {
  test("pooled two-proportion z", () => {
    expect(zScore(30, 100, 10, 100)).toBeCloseTo(2.5 * Math.SQRT2, 10); // 3.5355: the I10 correction of 3.82
    expect(zScore(30, 100, 10, 100)).toBeCloseTo(3.54, 2);
    expect(zScore(10, 100, 10, 100)).toBe(0);
    expect(zScore(0, 0, 10, 100)).toBe(0);
    expect(zScore(0, 100, 0, 100)).toBe(0); // p = 0: no variance
  });
});

test("campaign options: metric is reply|click|open, abResetDaily is a boolean", () => {
  expect(
    campaignPatchSchema.safeParse({ abWinnerMetric: "open", abResetDaily: true }).success,
  ).toBe(true);
  expect(campaignPatchSchema.safeParse({ abWinnerMetric: null }).success).toBe(true);
  expect(campaignPatchSchema.safeParse({ abWinnerMetric: "bounce" }).success).toBe(false);
});

describe("optimizeVariants", () => {
  test("a clear loser is paused and audited", async () => {
    const { s, v } = await setup();
    await seed(s, v.A!.id, 100, 30);
    await seed(s, v.B!.id, 100, 10);
    expect(await run()).toEqual({ paused: 1 });
    expect(await active(s.steps[0]!.id)).toEqual(["A"]);
    const a = await P().auditLog.findMany({ where: { action: "variant.auto_paused" } });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ workspaceId: s.ws, target: v.B!.id, actorId: null });
    expect(a[0]!.meta).toEqual({ metric: "reply", n: 100, k: 10, best: "A" });
    const shown = (await getSequence(P(), s.ws, s.campaign.id)).steps[0]!.variants;
    expect(shown.map((x) => [x.label, x.autoPausedMetric])).toEqual([
      ["A", null],
      ["B", "reply"],
    ]);
  });

  test.each([
    ["z below 1.96", 100, 12, 100, 10],
    ["sample below 100 on the best", 99, 30, 100, 10],
    ["sample below 100 on the loser", 100, 30, 99, 10],
  ])("both stay active: %s", async (_name, nA, kA, nB, kB) => {
    const { s, v } = await setup();
    await seed(s, v.A!.id, nA, kA);
    await seed(s, v.B!.id, nB, kB);
    expect(await run()).toEqual({ paused: 0 });
    expect(await active(s.steps[0]!.id)).toEqual(["A", "B"]);
  });

  test("A, B, C where B and C lose: both paused, A stays", async () => {
    const { s, v } = await setup(["B", "C"]);
    await seed(s, v.A!.id, 100, 30);
    await seed(s, v.B!.id, 100, 10);
    await seed(s, v.C!.id, 100, 5);
    expect(await run()).toEqual({ paused: 2 });
    expect(await active(s.steps[0]!.id)).toEqual(["A"]);
  });

  test("only one active variant: unchanged", async () => {
    const { s, v } = await setup();
    await seed(s, v.A!.id, 100, 30);
    await seed(s, v.B!.id, 100, 10);
    await P().stepVariant.update({ where: { id: v.B!.id }, data: { active: false } });
    expect(await run()).toEqual({ paused: 0 });
    expect(await active(s.steps[0]!.id)).toEqual(["A"]);
  });

  test.each([{ abAutoOptimize: false }, { status: "PAUSED" as const }])(
    "unchanged when the campaign is %o",
    async (campaign) => {
      const { s, v } = await setup(["B"], campaign);
      await seed(s, v.A!.id, 100, 30);
      await seed(s, v.B!.id, 100, 10);
      expect(await run()).toEqual({ paused: 0 });
      expect(await active(s.steps[0]!.id)).toEqual(["A", "B"]);
    },
  );

  test("metric click ignores scanner clicks", async () => {
    const { s, v } = await setup(["B"], { abWinnerMetric: "click" });
    await seed(s, v.A!.id, 100, 30, "CLICK", { scanner: true }); // A has no real click
    await seed(s, v.B!.id, 100, 10, "CLICK");
    expect(await run()).toEqual({ paused: 1 });
    expect(await active(s.steps[0]!.id)).toEqual(["B"]);
  });

  test("metric open ignores machine opens", async () => {
    const { s, v } = await setup(["B"], { abWinnerMetric: "open" });
    await seed(s, v.A!.id, 100, 30, "OPEN", { machine: true });
    await seed(s, v.B!.id, 100, 10, "OPEN");
    expect(await run()).toEqual({ paused: 1 });
    expect(await active(s.steps[0]!.id)).toEqual(["B"]);
  });

  test("replies count once per lead; a REPLY of an erased lead (null leadId) counts once", async () => {
    const { s, v } = await setup();
    await seed(s, v.A!.id, 100, 30);
    await seed(s, v.B!.id, 100, 0);
    const mk = (i: number, leadId: string | null) => ({
      workspaceId: s.ws,
      campaignId: s.campaign.id,
      stepId: s.steps[0]!.id,
      variantId: v.B!.id,
      type: "REPLY" as const,
      occurredAt: T,
      leadId,
      dedupeKey: `x:${i}`,
    });
    // one lead replying three times and one erased lead: k = 2
    await P().event.createMany({ data: [mk(1, "r"), mk(2, "r"), mk(3, "r"), mk(4, null)] });
    await run();
    const a = await P().auditLog.findFirstOrThrow({ where: { action: "variant.auto_paused" } });
    expect(a.meta).toMatchObject({ n: 100, k: 2 });
  });

  test("race: a concurrent user edit never leaves zero active variants and neither call errors", async () => {
    const { s, v } = await setup();
    await seed(s, v.A!.id, 100, 30);
    await seed(s, v.B!.id, 100, 10);
    const r = await Promise.allSettled([
      run(),
      updateVariant(P(), s.ws, null, v.B!.id, { active: true }),
    ]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await active(s.steps[0]!.id)).length).toBeGreaterThanOrEqual(1);
    // the user deactivating A while the optimizer pauses B: one of the two wins, never both
    await P().stepVariant.updateMany({ where: { stepId: s.steps[0]!.id }, data: { active: true } });
    await P().auditLog.deleteMany({});
    const r2 = await Promise.allSettled([
      run(),
      updateVariant(P(), s.ws, null, v.A!.id, { active: false }),
    ]);
    expect(r2[0]!.status).toBe("fulfilled");
    expect((await active(s.steps[0]!.id)).length).toBeGreaterThanOrEqual(1);
  });

  test("re-activation: not paused again until n has grown by 100", async () => {
    const { s, v } = await setup();
    await seed(s, v.A!.id, 100, 30);
    await seed(s, v.B!.id, 100, 10);
    expect(await run()).toEqual({ paused: 1 });
    await updateVariant(P(), s.ws, null, v.B!.id, { active: true });
    expect(await run()).toEqual({ paused: 0 }); // same n
    await seed(s, v.B!.id, 99, 0);
    expect(await run()).toEqual({ paused: 0 }); // n 199
    await seed(s, v.B!.id, 1, 0);
    expect(await run()).toEqual({ paused: 1 }); // n 200
    expect(await active(s.steps[0]!.id)).toEqual(["A"]);
  });

  test("replan: B's SCHEDULED row is cancelled and re-planned onto A; a claimed row keeps B", async () => {
    const { s, v } = await setup(["B"], {}, 2);
    const row = (i: number, status: "SCHEDULED" | "SENDING") =>
      P().scheduledMessage.create({
        data: {
          idempotencyKey: `${s.leads[i]!.cl.id}:${s.steps[0]!.id}`,
          workspaceId: s.ws,
          campaignId: s.campaign.id,
          campaignLeadId: s.leads[i]!.cl.id,
          stepId: s.steps[0]!.id,
          variantId: v.B!.id,
          accountId: s.accounts[0]!.id,
          dueAt: T,
          renderedSubject: "B",
          renderedBody: "b",
          renderedText: "b",
          status,
        },
      });
    const [queued, claimed] = [await row(0, "SCHEDULED"), await row(1, "SENDING")];
    await seed(s, v.A!.id, 100, 30);
    await seed(s, v.B!.id, 100, 10);
    expect(await run()).toEqual({ paused: 1 });
    const get = (id: string) => P().scheduledMessage.findUniqueOrThrow({ where: { id } });
    expect((await get(queued.id)).status).toBe("CANCELLED");
    expect(await get(claimed.id)).toMatchObject({ status: "SENDING", variantId: v.B!.id });
    await markFresh(P(), [s.accounts[0]!.id], T);
    await planDue(P(), fixedClock(T), {
      stalenessSec: 300,
      sendableProviders: ["SMTP"],
      env: {
        appUrl: "https://app.example.com",
        unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
      },
    });
    expect(await get(queued.id)).toMatchObject({ status: "SCHEDULED", variantId: v.A!.id });
  });
});
