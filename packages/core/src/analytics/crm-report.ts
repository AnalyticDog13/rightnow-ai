import { Prisma, type PrismaClient, type StageKind } from "@rightnow/db/client";
import { analytics, OPP_FROM, oppScope } from "./metrics";
import { type AnalyticsQuery, checked, inRange, rangeDays } from "./query";

type Db = PrismaClient | Prisma.TransactionClient;
const sql = Prisma.sql;
const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

/**
 * D42 revenue and conversion (PS-CRM-11, PS-ANALYTICS-12/13). Counts every deal of the filters, with or without a
 * campaign. Pipeline value and conversion are "current" (range-independent state, Rev 2 M7); won and cash are deals
 * in a WON stage whose closedAt is in range, so a reopened and re-won deal counts once.
 */
export async function crmReport(
  db: Db,
  ws: string,
  q: AnalyticsQuery,
): Promise<{
  currency: string;
  pipelineValue: string;
  openCount: number;
  avgDealSize: string | null;
  wonValue: string;
  cashCollected: string;
  annualizedClosed: string;
  revenuePerLead: string | null;
  conversionByStage: { stageId: string; name: string; count: number; reachedPct: number | null }[];
  revenueByCampaign: {
    campaignId: string | null;
    name: string;
    won: number;
    cashCollected: string;
  }[];
}> {
  const days = rangeDays(q);
  const [w, stages, won, a] = await checked(
    Promise.all([
      db.workspace.findUniqueOrThrow({ where: { id: ws }, select: { currency: true } }),
      db.$queryRaw<
        {
          id: string;
          name: string;
          kind: StageKind;
          position: number;
          created: number;
          current: number;
          value: Prisma.Decimal;
        }[]
      >`
        SELECT s.id, s.name, s.kind, s.position,
          count(o.id) FILTER (WHERE ${inRange(sql`o."createdAt"`, q)})::int AS created,
          count(o.id)::int AS current, COALESCE(sum(o.value), 0) AS value
        FROM "PipelineStage" s
        LEFT JOIN (SELECT o.* FROM ${OPP_FROM(ws)} WHERE ${oppScope(ws, q, false)}) o ON o."stageId" = s.id
        WHERE s."workspaceId" = ${ws}
        GROUP BY s.id ORDER BY s.position`,
      db.$queryRaw<
        { campaignId: string | null; won: number; value: Prisma.Decimal; cash: Prisma.Decimal }[]
      >`
        SELECT o."campaignId", count(*)::int AS won, sum(o.value) AS value, sum(o."cashCollected") AS cash
        FROM ${OPP_FROM(ws)} JOIN "PipelineStage" s ON s.id = o."stageId" AND s.kind = 'WON'
        WHERE ${oppScope(ws, q, false)} AND ${inRange(sql`o."closedAt"`, q)}
        GROUP BY o."campaignId"`,
      analytics(db, ws, { ...q, groupBy: "none" }),
    ]),
  );
  const names = new Map(
    (
      await db.campaign.findMany({
        where: { workspaceId: ws, id: { in: won.flatMap((r) => r.campaignId ?? []) } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name]),
  );
  const open = stages.filter((s) => s.kind === "OPEN");
  const wonN = won.reduce((n, r) => n + r.won, 0);
  const wonValue = won.reduce((s, r) => s.add(r.value), D(0));
  const cash = won.reduce((s, r) => s.add(r.cash), D(0));
  const cohort = stages.reduce((n, s) => n + s.created, 0);
  const contacted = a.total.contacted;
  return {
    currency: w.currency,
    pipelineValue: open.reduce((s, x) => s.add(x.value), D(0)).toFixed(2),
    openCount: open.reduce((n, x) => n + x.current, 0),
    avgDealSize: wonN ? wonValue.div(wonN).toFixed(2) : null,
    wonValue: wonValue.toFixed(2),
    cashCollected: cash.toFixed(2),
    annualizedClosed: wonValue.mul(365).div(days).toFixed(2),
    revenuePerLead: contacted ? cash.div(contacted).toFixed(2) : null,
    // "by current stage": deals created in range now in this stage or a later OPEN/WON one; LOST only in its own
    conversionByStage: stages.map((s) => ({
      stageId: s.id,
      name: s.name,
      count: s.created,
      reachedPct: cohort
        ? stages
            .filter(
              (t) =>
                t.id === s.id ||
                (s.kind !== "LOST" && t.kind !== "LOST" && t.position > s.position),
            )
            .reduce((n, t) => n + t.created, 0) / cohort
        : null,
    })),
    revenueByCampaign: won
      .map((r) => ({
        campaignId: r.campaignId,
        name: r.campaignId ? (names.get(r.campaignId) ?? r.campaignId) : "No campaign",
        won: r.won,
        cashCollected: D(r.cash).toFixed(2),
      }))
      .sort((x, y) => D(y.cashCollected).cmp(x.cashCollected)),
  };
}
