import { Prisma, type EmailAccount, type PrismaClient } from "@rightnow/db/client";
import { dayKey } from "../accounts/daykey";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { effectiveAllowance } from "../quota";

type Db = PrismaClient | Prisma.TransactionClient;

/** D34 inputs. Every count only includes events after max(window start, EmailAccount.healthResetAt) (Rev 2 I3). */
export type HealthInputs = {
  accepted7d: number;
  hard7d: number;
  soft7d: number;
  accepted30d: number;
  complaints30d: number;
  providerErrors24h: number;
  syncFailing: boolean;
  dnsLevel: "ok" | "warn" | "block" | null;
  warmup: { inbox: number; spam: number } | null;
  placement: { inbox: number; total: number } | null;
};
/** Plus the hard-bounce rate since the last health change (healthCapAt), which drives throttle and restore. */
type Counts = HealthInputs & { hardSinceCap: number; acceptedSinceCap: number };

const H = 3600_000;
const SYNC_FAILING_AT = 5; // mail/sync.ts ESCALATE_AT
const PAUSE_FLOOR = 50; // Rev 2 I4 / PS-CAMP-27: no account pause on fewer accepted sends in 7 days
const COMPLAINT_LINE = 0.1; // % (compliance line)

// damped denominators (D34): a handful of sends cannot produce an extreme rate
const pct = (n: number, d: number, floor: number) => (100 * n) / Math.max(d, floor);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** D34 score, 0–100: an internal indicator, not a reputation guarantee. */
export function healthScore(i: HealthInputs): number {
  const w = i.warmup && i.warmup.inbox + i.warmup.spam;
  const s =
    100 -
    Math.min(40, 10 * pct(i.hard7d, i.accepted7d, 20)) -
    Math.min(10, 2 * pct(i.soft7d, i.accepted7d, 20)) -
    Math.min(30, 100 * pct(i.complaints30d, i.accepted30d, 1000)) -
    (i.providerErrors24h >= 5 ? 20 : i.providerErrors24h >= 1 ? 10 : 0) -
    (i.syncFailing ? 20 : 0) -
    (i.dnsLevel === "block" ? 25 : i.dnsLevel === "warn" ? 10 : 0) -
    (w && w >= 10 ? Math.round((20 * i.warmup!.spam) / w) : 0) -
    (i.placement?.total ? Math.round(20 * (1 - i.placement.inbox / i.placement.total)) : 0);
  return Math.max(0, Math.min(100, Math.round(s)));
}

// a DSN or ARF that matched no send of ours proves nothing (its From is unauthenticated, D27): it never counts
const targeted = Prisma.sql`(e.type NOT IN ('BOUNCE_HARD', 'BOUNCE_SOFT', 'BOUNCE_UNKNOWN', 'COMPLAINT')
  OR e."scheduledMessageId" IS NOT NULL)`;

async function counts(db: Db, ids: string[], now: Date): Promise<Map<string, Counts>> {
  if (!ids.length) return new Map();
  const ts = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const [t24, t7, t30] = [ts(24 * H), ts(7 * 24 * H), ts(30 * 24 * H)];
  // GREATEST ignores NULL: no reset (or no cap change) means the plain window
  const since = (t: string) => Prisma.sql`GREATEST(${t}::timestamp, a."healthResetAt")`;
  const hard = Prisma.sql`(e.type = 'BOUNCE_HARD' OR (e.type = 'SEND_FAILED' AND e.meta->>'scope' = 'recipient'))`;
  const rows = await db.$queryRaw<
    (Omit<Counts, "syncFailing" | "dnsLevel" | "warmup" | "placement"> & {
      id: string;
      syncErrors: number;
      dnsLevel: Counts["dnsLevel"];
    })[]
  >`
    SELECT a.id, a."syncErrors",
      count(*) FILTER (WHERE e.type = 'ACCEPTED' AND e."occurredAt" >= ${since(t7)})::int AS "accepted7d",
      count(*) FILTER (WHERE ${hard} AND e."occurredAt" >= ${since(t7)})::int AS "hard7d",
      count(*) FILTER (WHERE e.type IN ('BOUNCE_SOFT', 'BOUNCE_UNKNOWN') AND e."occurredAt" >= ${since(t7)})::int AS "soft7d",
      count(*) FILTER (WHERE e.type = 'ACCEPTED')::int AS "accepted30d",
      count(*) FILTER (WHERE e.type = 'COMPLAINT')::int AS "complaints30d",
      count(*) FILTER (WHERE e.type = 'ACCEPTED'
        AND e."occurredAt" >= GREATEST(${since(t7)}, a."healthCapAt"))::int AS "acceptedSinceCap",
      count(*) FILTER (WHERE ${hard} AND e."occurredAt" >= GREATEST(${since(t7)}, a."healthCapAt"))::int AS "hardSinceCap",
      (count(*) FILTER (WHERE e.type = 'SEND_FAILED' AND e.meta->>'scope' IN ('account', 'unknown')
          AND e."occurredAt" >= ${since(t24)})
        + (SELECT count(*) FROM "SyncRun" r WHERE r."accountId" = a.id AND r.error IS NOT NULL
            AND r.error <> 'lease_lost' AND r."startedAt" >= ${since(t24)}))::int AS "providerErrors24h",
      (SELECT CASE WHEN d.level IN ('ok', 'warn', 'block') THEN d.level END FROM "DomainCheck" d WHERE d."workspaceId" = a."workspaceId"
        AND d.domain = split_part(a.email, '@', 2)) AS "dnsLevel"
    FROM "EmailAccount" a
    LEFT JOIN "Event" e ON e."workspaceId" = a."workspaceId" AND e."accountId" = a.id
      AND e.type IN ('ACCEPTED', 'BOUNCE_HARD', 'BOUNCE_SOFT', 'BOUNCE_UNKNOWN', 'COMPLAINT', 'SEND_FAILED')
      AND ${targeted} AND e."occurredAt" >= ${since(t30)}
    WHERE a.id = ANY(${ids}::text[])
    GROUP BY a.id`;
  return new Map(
    rows.map(({ id, syncErrors, ...r }) => [
      id,
      { ...r, syncFailing: syncErrors >= SYNC_FAILING_AT, warmup: null, placement: null }, // T03 / T04 fill these
    ]),
  );
}

/** D34 inputs per account, in two grouped statements whatever the number of accounts. */
export const healthInputs: (
  db: Db,
  accountIds: string[],
  now: Date,
) => Promise<Map<string, HealthInputs>> = counts;

type Account = EmailAccount & {
  workspace: { bounceThresholdPct: number; healthSlowdownPct: number };
};
type Action = "throttled" | "restored" | "paused";

/**
 * One account: score (EmailAccount.healthScore + today's HealthSnapshot), then throttle / restore / pause, each an
 * `updateMany` conditional on the values read. EmailAccount first, then the leaf rows (snapshot, audit).
 */
async function evaluateAccount(prisma: PrismaClient, now: Date, a: Account, i: Counts) {
  const done: Action[] = [];
  const score = healthScore(i);
  const thr = a.workspace.bounceThresholdPct;
  const hardPct = pct(i.hard7d, i.accepted7d, 20);
  const complaintPct = pct(i.complaints30d, i.accepted30d, 1000);
  const base = effectiveAllowance({ ...a, healthCap: null }, now); // the allowance without the health term
  // only bounces since the last health change count, or a lifted cap would be re-imposed by the same bounces
  const reason =
    pct(i.hardSinceCap, i.acceptedSinceCap, 20) > 2
      ? "bounce_rate"
      : i.providerErrors24h >= 5
        ? "provider_errors"
        : i.dnsLevel === "block"
          ? "dns_block"
          : null;
  const meta = {
    hardPct: round2(hardPct),
    complaintPct: round2(complaintPct),
    accepted7d: i.accepted7d,
    providerErrors24h: i.providerErrors24h,
    dnsLevel: i.dnsLevel,
  };
  const ctx = { workspaceId: a.workspaceId, at: now };
  // healthResetAt too: counts read before a concurrent resume must not act on the resumed account
  const same = {
    id: a.id,
    healthCap: a.healthCap,
    healthCapAt: a.healthCapAt,
    healthResetAt: a.healthResetAt,
  };

  await prisma.$transaction(async (tx) => {
    await tx.emailAccount.updateMany({ where: { id: a.id }, data: { healthScore: score } });
    if (a.healthCap === null && reason) {
      const cap = Math.max(1, Math.floor((base * a.workspace.healthSlowdownPct) / 100));
      const r = await tx.emailAccount.updateMany({
        where: same,
        data: { healthCap: cap, healthCapAt: now },
      });
      if (r.count) {
        done.push("throttled");
        await audit(tx, ctx, "account.health_throttle", a.id, { ...meta, reason, cap });
      }
    } else if (
      a.healthCap !== null &&
      a.healthCapAt &&
      now.getTime() - a.healthCapAt.getTime() >= 24 * H &&
      i.hardSinceCap === 0 &&
      i.providerErrors24h < 5 &&
      i.dnsLevel !== "block"
    ) {
      const cap = a.healthCap * 2 >= base ? null : a.healthCap * 2;
      const r = await tx.emailAccount.updateMany({
        where: same,
        data: { healthCap: cap, healthCapAt: now },
      });
      if (r.count) {
        done.push("restored");
        await audit(tx, ctx, "account.health_throttle", a.id, { ...meta, reason: "restore", cap });
      }
    }
    const pause =
      i.accepted7d >= PAUSE_FLOOR
        ? hardPct > thr
          ? "bounce_rate"
          : complaintPct > COMPLAINT_LINE
            ? "complaint_rate"
            : null
        : null;
    // a user pause, NEEDS_ATTENTION or INACTIVE is left alone; only a manual resume ends this one
    if (pause && (a.lifecycle === "ACTIVE" || a.lifecycle === "REWARMING")) {
      const error = {
        kind: "SOFT_BOUNCE",
        code: pause,
        message:
          pause === "bounce_rate"
            ? `Paused: ${round2(hardPct)} % hard bounces in 7 days (limit ${thr} %)`
            : `Paused: ${round2(complaintPct)} % spam complaints in 30 days (limit ${COMPLAINT_LINE} %)`,
      };
      // an existing error (e.g. SYNC) stays underneath as `previous`; resume and a caught-up sync unwrap it (D39)
      const r = await tx.$executeRaw`
        UPDATE "EmailAccount" SET lifecycle = 'PAUSED', "pausedUntil" = NULL,
          "lastErrorAt" = ${now.toISOString()}::timestamp,
          "lastError" = ${JSON.stringify(error)}::jsonb || CASE
            WHEN "lastError" IS NULL OR "lastError" = 'null' OR "lastError"->>'kind' = 'SOFT_BOUNCE' THEN '{}'::jsonb
            ELSE jsonb_build_object('previous', "lastError") END
        WHERE id = ${a.id} AND "deletedAt" IS NULL AND lifecycle = ${a.lifecycle}::"AccountLifecycle"
          AND "healthResetAt" IS NOT DISTINCT FROM ${a.healthResetAt?.toISOString() ?? null}::timestamp`;
      if (r) {
        done.push("paused");
        await audit(tx, ctx, "account.health_pause", a.id, { ...meta, reason: pause });
      }
    }
    const day = new Date(`${dayKey(a.timezone, now)}T00:00:00Z`);
    await tx.healthSnapshot.upsert({
      where: { accountId_day: { accountId: a.id, day } },
      create: { accountId: a.id, day, score },
      update: { score },
    });
  });
  return done;
}

/** BounceProtect (D34): plain ratios over the campaign's own sends since max(window, bounceProtectResetAt). */
async function bounceProtect(prisma: PrismaClient, now: Date): Promise<number> {
  const ts = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const since = (t: string) => Prisma.sql`GREATEST(${t}::timestamp, c."bounceProtectResetAt")`;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      workspaceId: string;
      thr: number;
      accepted24h: number;
      hard24h: number;
      accepted30d: number;
      complaints30d: number;
    }[]
  >`
    SELECT c.id, c."workspaceId", w."bounceThresholdPct" AS thr,
      count(*) FILTER (WHERE e.type = 'ACCEPTED' AND e."occurredAt" >= ${since(ts(24 * H))})::int AS "accepted24h",
      count(*) FILTER (WHERE (e.type = 'BOUNCE_HARD' OR (e.type = 'SEND_FAILED' AND e.meta->>'scope' = 'recipient'))
        AND e."occurredAt" >= ${since(ts(24 * H))})::int AS "hard24h",
      count(*) FILTER (WHERE e.type = 'ACCEPTED')::int AS "accepted30d",
      count(*) FILTER (WHERE e.type = 'COMPLAINT')::int AS "complaints30d"
    FROM "Campaign" c
    JOIN "Workspace" w ON w.id = c."workspaceId"
    JOIN "Event" e ON e."campaignId" = c.id
      AND e.type IN ('ACCEPTED', 'BOUNCE_HARD', 'SEND_FAILED', 'COMPLAINT') AND ${targeted}
      AND e."occurredAt" >= ${since(ts(30 * 24 * H))}
    WHERE c.status = 'ACTIVE' AND c."bounceProtect" AND c."deletedAt" IS NULL
    GROUP BY c.id, w."bounceThresholdPct"`;
  let n = 0;
  for (const c of rows) {
    const hardPct = c.accepted24h ? (100 * c.hard24h) / c.accepted24h : 0;
    const complaintPct = pct(c.complaints30d, c.accepted30d, 1000);
    const reason =
      c.accepted24h >= PAUSE_FLOOR && hardPct > c.thr
        ? "bounce_rate"
        : complaintPct > COMPLAINT_LINE
          ? "complaint_rate"
          : null;
    if (!reason) continue;
    await prisma.$transaction(async (tx) => {
      const r = await tx.campaign.updateMany({
        where: { id: c.id, status: "ACTIVE", bounceProtect: true, deletedAt: null },
        data: { status: "BOUNCE_PROTECT" },
      });
      if (!r.count) return;
      n++;
      const { id, workspaceId, thr, ...numbers } = c;
      await audit(tx, { workspaceId, at: now }, "campaign.bounce_protect", id, {
        reason,
        ...numbers,
        hardPct: round2(hardPct),
        complaintPct: round2(complaintPct),
        thresholdPct: thr,
      });
    });
  }
  return n;
}

/**
 * ACTIVE ⇄ ACCOUNTS_UNHEALTHY (D34): a campaign with live assigned accounts of which none is sendable
 * (lifecycle ACTIVE/REWARMING and CONNECTED). Staleness never counts, or every wake would flip campaigns.
 */
async function flipUnhealthy(prisma: PrismaClient, now: Date, to: "ACCOUNTS_UNHEALTHY" | "ACTIVE") {
  const from = to === "ACTIVE" ? "ACCOUNTS_UNHEALTHY" : "ACTIVE";
  const assigned = (extra: Prisma.Sql) => Prisma.sql`EXISTS (SELECT 1 FROM "CampaignAccount" ca
      JOIN "EmailAccount" a ON a.id = ca."accountId"
      WHERE ca."campaignId" = c.id AND a."deletedAt" IS NULL ${extra})`;
  const sendable = assigned(
    Prisma.sql`AND a.lifecycle IN ('ACTIVE', 'REWARMING') AND a.status = 'CONNECTED'`,
  );
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; workspaceId: string; assigned: number; sendable: number }[]
    >`
      UPDATE "Campaign" c SET status = ${to}::"CampaignStatus", "updatedAt" = ${now.toISOString()}::timestamp
      WHERE c.status = ${from}::"CampaignStatus" AND c."deletedAt" IS NULL
        AND ${to === "ACTIVE" ? sendable : Prisma.sql`${assigned(Prisma.empty)} AND NOT ${sendable}`}
      RETURNING c.id, c."workspaceId",
        (SELECT count(*)::int FROM "CampaignAccount" ca JOIN "EmailAccount" a ON a.id = ca."accountId"
          WHERE ca."campaignId" = c.id AND a."deletedAt" IS NULL) AS assigned,
        (SELECT count(*)::int FROM "CampaignAccount" ca JOIN "EmailAccount" a ON a.id = ca."accountId"
          WHERE ca."campaignId" = c.id AND a."deletedAt" IS NULL AND a.lifecycle IN ('ACTIVE', 'REWARMING')
            AND a.status = 'CONNECTED') AS sendable`;
    for (const { id, workspaceId, ...n } of rows)
      await audit(tx, { workspaceId, at: now }, "campaign.accounts_unhealthy", id, {
        status: to,
        ...n,
      });
    return rows.length;
  });
}

/**
 * The `deliverability-health` job (every 5 min): accounts (score, snapshot, throttle/restore/pause), then campaigns
 * (ACCOUNTS_UNHEALTHY → ACTIVE, BounceProtect, then ACTIVE → ACCOUNTS_UNHEALTHY). Scans every workspace; every write is conditional on what it read.
 */
export async function evaluateHealth(
  prisma: PrismaClient,
  clock: Clock,
): Promise<{
  throttled: number;
  restored: number;
  paused: number;
  bounceProtected: number;
  unhealthy: number;
  recovered: number;
  rewarmsCompleted: number;
}> {
  const now = clock.now();
  const out = { throttled: 0, restored: 0, paused: 0 };
  const accounts = await prisma.emailAccount.findMany({
    where: { deletedAt: null },
    include: { workspace: { select: { bounceThresholdPct: true, healthSlowdownPct: true } } },
    orderBy: { id: "asc" },
  });
  const inputs = await counts(
    prisma,
    accounts.map((a) => a.id),
    now,
  );
  for (const a of accounts)
    try {
      for (const k of await evaluateAccount(prisma, now, a, inputs.get(a.id)!)) out[k]++;
    } catch (e) {
      console.error(`evaluateHealth: account ${a.id} skipped this run`, e);
    }
  // recovery first, so a campaign that comes back is checked by BounceProtect in the same run
  const recovered = await flipUnhealthy(prisma, now, "ACTIVE");
  const bounceProtected = await bounceProtect(prisma, now);
  const unhealthy = await flipUnhealthy(prisma, now, "ACCOUNTS_UNHEALTHY");
  // shortcut: re-warm completion arrives with P5-T06 (completeRewarms), called here
  return { ...out, bounceProtected, unhealthy, recovered, rewarmsCompleted: 0 };
}
