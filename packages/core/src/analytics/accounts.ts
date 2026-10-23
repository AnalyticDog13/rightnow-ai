import { Prisma, type PrismaClient } from "@rightnow/db/client";
import { listAccounts } from "../accounts/service";
import { HARD_BOUNCE_SQL, perLead } from "../deliverability/health";
import { analytics } from "./metrics";
import { type AnalyticsQuery, checked, EVENT_FROM, eventScope, rangeDays } from "./query";

type Db = PrismaClient | Prisma.TransactionClient;
const sql = Prisma.sql;

/**
 * PS-ANALYTICS-14: one row per live account, its range metrics by sender (M5), the D34 health score and its 30-day
 * trend, and today's remaining allowance (listAccounts, the accounts page's own number).
 */
export async function accountAnalytics(
  db: Db,
  ws: string,
  q: AnalyticsQuery,
  now: Date,
): Promise<
  {
    id: string;
    email: string;
    sent: number;
    contacted: number;
    opened: number;
    replied: number;
    replyRate: number | null;
    healthScore: number | null;
    trend: { day: string; score: number }[];
    remainingToday: number;
  }[]
> {
  const [{ accounts }, m] = await Promise.all([
    // shortcut: the first 500 live accounts; page through listAccounts if a workspace ever has more
    listAccounts(db as PrismaClient, ws, { take: 500 }, { clock: { now: () => now } }),
    analytics(db, ws, { ...q, groupBy: "account" }),
  ]);
  const live = q.accountIds ? accounts.filter((a) => q.accountIds!.includes(a.id)) : accounts;
  const snaps = await db.healthSnapshot.findMany({
    where: {
      accountId: { in: live.map((a) => a.id) },
      day: { gte: new Date(Date.parse(now.toISOString().slice(0, 10)) - 30 * 86_400_000) },
    },
    orderBy: { day: "asc" },
  });
  const rows = new Map(m.rows.map((r) => [r.key, r]));
  return live.map((a) => {
    const r = rows.get(a.id);
    return {
      id: a.id,
      email: a.email,
      sent: r?.sent ?? 0,
      contacted: r?.contacted ?? 0,
      opened: r?.opened ?? 0,
      replied: r?.replied ?? 0,
      replyRate: r?.rates.reply ?? null,
      healthScore: a.health.score,
      trend: snaps
        .filter((s) => s.accountId === a.id)
        .map((s) => ({ day: s.day.toISOString().slice(0, 10), score: s.score })),
      remainingToday: a.remainingToday,
    };
  });
}

type BounceType = "BOUNCE_HARD" | "BOUNCE_SOFT" | "BOUNCE_UNKNOWN" | "SEND_FAILED";

/** PS-ANALYTICS-08: bounce counts (D34 definitions, once per lead) and the top 20 reasons (per event). */
export async function bounceBreakdown(
  db: Db,
  ws: string,
  q: AnalyticsQuery,
): Promise<{
  hard: number;
  soft: number;
  unknown: number;
  reasons: { type: BounceType; reason: string; count: number }[];
}> {
  rangeDays(q);
  const bounce = sql`(e.type IN ('BOUNCE_HARD', 'BOUNCE_SOFT', 'BOUNCE_UNKNOWN') OR ${HARD_BOUNCE_SQL})`;
  const [[n], reasons] = await checked(
    Promise.all([
      db.$queryRaw<{ hard: number; soft: number; unknown: number }[]>`
        SELECT ${perLead(HARD_BOUNCE_SQL)} AS hard, ${perLead(sql`e.type = 'BOUNCE_SOFT'`)} AS soft,
          ${perLead(sql`e.type = 'BOUNCE_UNKNOWN'`)} AS unknown
        FROM ${EVENT_FROM} WHERE ${eventScope(ws, q)} AND ${bounce}`,
      db.$queryRaw<{ type: BounceType; reason: string; count: number }[]>`
        SELECT e.type::text AS type, COALESCE(e.meta->>'reason', e.meta->>'error', 'unknown') AS reason,
          count(*)::int AS count
        FROM ${EVENT_FROM} WHERE ${eventScope(ws, q)} AND ${bounce}
        GROUP BY 1, 2 ORDER BY count DESC, type, reason LIMIT 20`,
    ]),
  );
  return { ...n!, reasons };
}
