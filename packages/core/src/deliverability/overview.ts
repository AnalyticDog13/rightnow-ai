import { Prisma, type AccountProvider, type PrismaClient } from "@rightnow/db/client";
import { effectiveAllowance } from "../quota";
import { type DomainReport, findings } from "./dns";
import { HARD_BOUNCE_SQL, perLead, TARGETED_SQL } from "./health";
import { idleSince } from "./lifecycle";
import { rewarmPlanView } from "./rewarm";
import {
  warmupDays,
  warmupUsable,
  warmupRowsWhere,
  warmupSince,
  warmupState,
  type WarmupDay,
  type WarmupState,
} from "./warmup";
import { domainOf } from "../leads/domain";

type Db = PrismaClient | Prisma.TransactionClient;
const DAY = 86_400_000;

export type AccountDeliverability = {
  id: string;
  email: string;
  status: "Active" | "Inactive" | "Re-Warming" | "Paused" | "Needs Attention";
  idleDays: number;
  allowance: number;
  target: number;
  plan: ReturnType<typeof rewarmPlanView>;
  health: { score: number | null; trend: { day: string; score: number }[]; cap: number | null };
  sent30d: number;
  hardBouncePct30d: number;
  softBouncePct30d: number;
  complaintPct30d: number; // only fed by a feedback loop that delivers to a connected mailbox (Gmail sends none)
  replyPct30d: number;
  lastBounceReasons: string[];
  recentErrors: number;
  lastWarmupAt: Date | null; // display only: warm-up is not campaign activity (Rev 2 I6)
  dns: { level: string; domain: string } | null;
  warmup: { state: WarmupState; last7: WarmupDay[] } | null;
  warnings: string[];
};

const STATUS = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  REWARMING: "Re-Warming",
  PAUSED: "Paused",
  NEEDS_ATTENTION: "Needs Attention",
} as const;
function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
}
const round1 = (x: number) => Math.round(x * 10) / 10;

type Counts = {
  id: string;
  accepted: number;
  hard: number;
  soft: number;
  complaints: number;
  replies: number;
};

/**
 * The deliverability dashboard (PS-REWARM-10, PS-WARM-11/12/20/21): one row per live account of the workspace. Eight
 * statements whatever the number of accounts, each filtered by workspace. Bounces and complaints use health.ts's own
 * D34 definitions, so the dashboard counts exactly what health counts.
 */
export async function deliverabilityOverview(
  prisma: Db,
  ws: string,
  now: Date,
  sendable: AccountProvider[], // D17 providers: `sendableProviders()`, as the drawer's `warmupView`
): Promise<AccountDeliverability[]> {
  const accounts = await prisma.emailAccount.findMany({
    where: { workspaceId: ws, deletedAt: null },
    orderBy: { email: "asc" },
  });
  if (!accounts.length) return [];
  const ids = accounts.map((a) => a.id);
  const t30 = new Date(now.getTime() - 30 * DAY);
  const day30 = new Date(Date.parse(t30.toISOString().slice(0, 10)));
  const warmSince = new Date(
    Math.min(...accounts.map((a) => warmupSince(a.timezone, 7, now).getTime())),
  );

  const [workspace, snaps, counts, reasons, checks, settings, warmRows, peerRows] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: ws }, select: { inactivityDays: true } }),
    prisma.healthSnapshot.findMany({
      where: { accountId: { in: ids }, day: { gte: day30 } },
      orderBy: { day: "asc" },
    }),
    prisma.$queryRaw<Counts[]>`
      SELECT e."accountId" AS id,
        count(*) FILTER (WHERE e.type = 'ACCEPTED')::int AS accepted,
        ${perLead(HARD_BOUNCE_SQL)} AS hard,
        count(*) FILTER (WHERE e.type IN ('BOUNCE_SOFT', 'BOUNCE_UNKNOWN'))::int AS soft,
        ${perLead(Prisma.sql`e.type = 'COMPLAINT'`)} AS complaints,
        count(*) FILTER (WHERE e.type = 'REPLY')::int AS replies
      FROM "Event" e
      WHERE e."workspaceId" = ${ws} AND e."accountId" = ANY(${ids}::text[])
        AND e."occurredAt" >= ${t30.toISOString()}::timestamp
        AND e.type IN ('ACCEPTED', 'BOUNCE_HARD', 'BOUNCE_SOFT', 'BOUNCE_UNKNOWN', 'SEND_FAILED', 'COMPLAINT', 'REPLY')
        AND ${TARGETED_SQL}
      GROUP BY e."accountId"`,
    prisma.$queryRaw<{ id: string; reason: string }[]>`
      SELECT id, reason FROM (
        SELECT e."accountId" AS id, e.meta->>'reason' AS reason,
          row_number() OVER (PARTITION BY e."accountId" ORDER BY e."occurredAt" DESC) AS rn
        FROM "Event" e
        WHERE e."workspaceId" = ${ws} AND e."accountId" = ANY(${ids}::text[])
          AND e."occurredAt" >= ${t30.toISOString()}::timestamp
          AND e.type IN ('BOUNCE_HARD', 'BOUNCE_SOFT', 'BOUNCE_UNKNOWN')
          AND e.meta->>'reason' IS NOT NULL AND ${TARGETED_SQL}) x
      WHERE rn <= 3 ORDER BY rn`,
    prisma.domainCheck.findMany({ where: { workspaceId: ws } }),
    prisma.warmupSettings.findMany({ where: { workspaceId: ws } }),
    prisma.warmupMessage.findMany({ where: warmupRowsWhere(ws, ids, warmSince) }),
    // the same filter warmupView and warmupTick use for peers
    prisma.warmupSettings.findMany({
      where: warmupUsable(sendable, ws),
      select: { accountId: true },
    }),
  ]);

  const trend = groupBy(snaps, (s) => s.accountId);
  const stat = new Map(counts.map((c) => [c.id, c]));
  const why = groupBy(reasons, (r) => r.id);
  const check = new Map(checks.map((c) => [c.domain, c]));
  const warm = new Map(settings.map((s) => [s.accountId, s]));
  const usable = new Set(peerRows.map((p) => p.accountId));

  return accounts.map((a) => {
    const c = stat.get(a.id);
    const accepted = c?.accepted ?? 0;
    const pct = (n = 0) => (accepted ? round1((100 * n) / accepted) : 0);
    const idleDays = Math.floor((now.getTime() - idleSince(a).getTime()) / DAY);
    const dc = check.get(domainOf(a.email));
    const found = dc ? findings(dc.report as DomainReport) : [];
    const dnsReason = (found.find((f) => f.level === "block") ?? found[0])?.reason;
    const s = warm.get(a.id) ?? null;
    const peers = usable.size - (usable.has(a.id) ? 1 : 0);
    const hardPct = c && accepted ? (100 * c.hard) / accepted : 0;
    const warnings = [
      ...(!a.rewarmStartedAt && (idleDays >= workspace.inactivityDays || a.lifecycle === "INACTIVE")
        ? [`Idle for ${idleDays} days`]
        : []),
      ...(a.healthCap !== null ? [`Health throttled to ${a.healthCap}/day`] : []),
      ...(dnsReason ? [`DNS: ${dnsReason}`] : []),
      ...(s?.enabled && peers < 1 ? ["Warm-up has no peers"] : []),
      ...(hardPct > 2 ? [`Hard bounces ${round1(hardPct)}% in 30 days`] : []),
    ];
    return {
      id: a.id,
      email: a.email,
      status: STATUS[a.lifecycle],
      idleDays,
      allowance: effectiveAllowance(a, now),
      target: a.rewarmTarget ?? a.dailyLimit,
      plan: rewarmPlanView(a, now),
      health: {
        score: a.healthScore,
        trend: (trend.get(a.id) ?? []).map((t) => ({
          day: t.day.toISOString().slice(0, 10),
          score: t.score,
        })),
        cap: a.healthCap,
      },
      sent30d: accepted,
      hardBouncePct30d: pct(c?.hard),
      softBouncePct30d: pct(c?.soft),
      complaintPct30d: pct(c?.complaints),
      replyPct30d: pct(c?.replies),
      lastBounceReasons: (why.get(a.id) ?? []).map((r) => r.reason),
      recentErrors: a.errorCount24h,
      lastWarmupAt: a.lastWarmupAt,
      dns: dc ? { level: dc.level, domain: dc.domain } : null,
      warmup: s
        ? {
            state: warmupState(a, s, peers, sendable),
            last7: warmupDays(warmRows, a.id, a.timezone, 7, now),
          }
        : null,
      warnings,
    };
  });
}
