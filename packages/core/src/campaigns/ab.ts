import { Prisma, type PrismaClient } from "@rightnow/db/client";
import { HUMAN_SQL, PERSON_SQL } from "../analytics/metrics";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { perLead } from "../deliverability/health";
import { withTxRetry } from "../dispatch";
import { editHooks } from "./hooks";

type Tx = Prisma.TransactionClient;
const MIN_N = 100; // D46: sends per variant before it can be compared, and the growth a re-activated variant needs
const Z = 1.96;
const sql = Prisma.sql;

/** The winner metric's event over Event alias `e`: the same human/person predicates as the D42 report. */
const METRICS = {
  reply: sql`e.type = 'REPLY'`,
  click: sql`e.type = 'CLICK' AND ${PERSON_SQL}`,
  open: sql`e.type = 'OPEN' AND ${HUMAN_SQL}`,
};

/** Pooled two-proportion z of "best beats v"; 0 when either side has no sends or the pooled rate has no variance. */
export function zScore(kBest: number, nBest: number, kV: number, nV: number): number {
  if (!nBest || !nV) return 0;
  const p = (kBest + kV) / (nBest + nV);
  const se = Math.sqrt(p * (1 - p) * (1 / nBest + 1 / nV));
  return se ? (kBest / nBest - kV / nV) / se : 0;
}

/**
 * D46: pauses the statistically losing variants of every ACTIVE auto-optimize campaign. One transaction per campaign,
 * under the same Campaign row lock as the variant edits (so a user edit cannot interleave and no step is left without
 * an active variant); the planner is not locked out: a row it plans on a variant paused a moment earlier is cancelled
 * and re-planned by the sender's render check.
 */
export async function optimizeVariants(
  prisma: PrismaClient,
  clock: Clock,
): Promise<{ paused: number }> {
  const campaigns = await prisma.campaign.findMany({
    where: { status: "ACTIVE", abAutoOptimize: true, deletedAt: null },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let paused = 0;
  for (const { id } of campaigns)
    try {
      paused += await withTxRetry(() =>
        prisma.$transaction((tx) => optimizeCampaign(tx, id, clock.now()), { timeout: 30_000 }),
      );
    } catch (e) {
      console.error(`ab-optimize: campaign ${id} skipped this run`, e);
    }
  return { paused };
}

async function optimizeCampaign(tx: Tx, campaignId: string, now: Date): Promise<number> {
  // NO KEY UPDATE conflicts with the edits' FOR UPDATE but not with the planner's FK inserts. Conditions re-read under the lock.
  const [c] = await tx.$queryRaw<{ workspaceId: string; abWinnerMetric: string | null }[]>`
    SELECT "workspaceId", "abWinnerMetric" FROM "Campaign"
    WHERE id = ${campaignId} AND status = 'ACTIVE' AND "abAutoOptimize" AND "deletedAt" IS NULL FOR NO KEY UPDATE`;
  if (!c) return 0;
  const metric = c.abWinnerMetric && c.abWinnerMetric in METRICS ? c.abWinnerMetric : "reply";
  const variants = await tx.$queryRaw<{ id: string; stepId: string; label: string }[]>`
    SELECT v.id, v."stepId", v.label FROM "StepVariant" v JOIN "SequenceStep" s ON s.id = v."stepId"
    WHERE s."campaignId" = ${campaignId} AND s."deletedAt" IS NULL AND v.active
    ORDER BY v.id FOR NO KEY UPDATE OF v`;
  const byStep = new Map<string, typeof variants>();
  for (const v of variants) byStep.set(v.stepId, [...(byStep.get(v.stepId) ?? []), v]);
  const ids = [...byStep.values()]
    .filter((vs) => vs.length > 1)
    .flat()
    .map((v) => v.id);
  if (!ids.length) return 0;

  const counts = new Map(
    (
      await tx.$queryRaw<{ id: string; n: number; k: number }[]>`
        SELECT e."variantId" AS id, ${perLead(sql`e.type = 'ACCEPTED'`)} AS n,
          ${perLead(METRICS[metric as keyof typeof METRICS])} AS k
        FROM "Event" e
        WHERE e."workspaceId" = ${c.workspaceId} AND e."variantId" = ANY(${ids}::text[])
          AND (e.type = 'ACCEPTED' OR ${METRICS[metric as keyof typeof METRICS]})
        GROUP BY e."variantId"`
    ).map((r) => [r.id, r]),
  );
  // a re-activated variant (it has a last auto-pause) is compared again only after its n grew by MIN_N
  const prior = new Map<string, number>();
  for (const a of await tx.auditLog.findMany({
    where: { workspaceId: c.workspaceId, action: "variant.auto_paused", target: { in: ids } },
    orderBy: { createdAt: "desc" },
  }))
    if (!prior.has(a.target!))
      prior.set(a.target!, Number((a.meta as { n?: number } | null)?.n ?? 0));

  let paused = 0;
  for (const vs of byStep.values()) {
    const rows = vs.map((v) => ({
      ...v,
      n: counts.get(v.id)?.n ?? 0,
      k: counts.get(v.id)?.k ?? 0,
    }));
    // the highest rate, the lowest id on a tie; it is never paused, so the step keeps an active variant
    // only variants with enough sends are compared; the highest rate wins (lowest id on a tie) and is never paused
    const ok = rows.filter((r) => r.n >= MIN_N);
    if (ok.length < 2) continue;
    const best = ok.reduce((b, r) => (r.k * b.n > b.k * r.n ? r : b));
    for (const v of ok) {
      if (v === best || v.n < (prior.get(v.id) ?? -Infinity) + MIN_N) continue;
      if (zScore(best.k, best.n, v.k, v.n) < Z) continue;
      const r = await tx.stepVariant.updateMany({
        where: { id: v.id, active: true },
        data: { active: false },
      });
      if (!r.count) continue;
      await editHooks.variantChanged(tx, {
        workspaceId: c.workspaceId,
        campaignId,
        stepId: v.stepId,
        variantId: v.id,
        removed: false,
      });
      await audit(tx, { workspaceId: c.workspaceId, at: now }, "variant.auto_paused", v.id, {
        metric,
        n: v.n,
        k: v.k,
        best: best.label,
      });
      paused += 1;
    }
  }
  return paused;
}
