import { Prisma, type PrismaClient } from "@rightnow/db/client";
import { HARD_BOUNCE_SQL, perLead } from "../deliverability/health";
import {
  type AnalyticsQuery,
  checked,
  EVENT_FROM,
  eventScope,
  filters,
  inRange,
  localDay,
  rangeKeys,
  SENDER,
} from "./query";

type Db = PrismaClient | Prisma.TransactionClient;
const sql = Prisma.sql;

export type Metrics = {
  sent: number;
  contacted: number;
  newLeadsContacted: number;
  rateBase: number;
  opened: number;
  opens: number;
  machineOpens: number;
  clicked: number;
  clicks: number;
  clickedSends: number;
  replied: number;
  replies: number;
  autoReplies: number;
  hardBounced: number;
  softBounced: number;
  unknownBounced: number;
  unsubscribed: number;
  complaints: number;
  completed: number | null;
  meetings: number;
  opportunities: number;
  opportunityValue: string;
  won: number;
  wonValue: string;
  cashCollected: string;
  rates: {
    open: number | null;
    click: number | null;
    reply: number | null;
    positiveReply: number | null;
    bounce: number | null;
  };
};
type By = AnalyticsQuery["groupBy"];
type Grouped = { key: string | null; total: number };
type EventCounts = Grouped &
  Omit<
    Metrics,
    | "rateBase"
    | "completed"
    | "opportunities"
    | "opportunityValue"
    | "won"
    | "wonValue"
    | "cashCollected"
    | "rates"
  > & { leadsSent: number };
type OppCounts = Grouped & {
  opportunities: number;
  opportunityValue: Prisma.Decimal;
  won: number;
  wonValue: Prisma.Decimal;
  cashCollected: Prisma.Decimal;
};

/** The group key of a row; `at` is the timestamp a day view buckets by. */
function key(
  by: By,
  q: AnalyticsQuery,
  c: {
    campaign: Prisma.Sql;
    account: Prisma.Sql;
    step: Prisma.Sql;
    variant: Prisma.Sql;
    at: Prisma.Sql;
  },
): Prisma.Sql {
  switch (by) {
    case "campaign":
      return c.campaign;
    case "account":
      return c.account;
    case "step":
      return c.step;
    case "variant":
      return c.variant;
    case "day":
      return localDay(c.at, q);
    case "esp":
      return sql`l."espType"::text`;
    default:
      return sql`NULL::text`;
  }
}
const PER_GROUP: By[] = ["step", "variant", "account", "day"]; // Rev 2 I5
const COMPLETED: By[] = ["none", "campaign", "day", "esp"];

// the workspace as a constant, so the scan uses the workspace index and never reads other workspaces
const firstBefore = (ws: string, q: AnalyticsQuery, sameCampaign: boolean) =>
  sql`e.type = 'ACCEPTED' AND NOT EXISTS (SELECT 1 FROM "Event" p
    WHERE p."workspaceId" = ${ws} AND p.type = 'ACCEPTED' AND p."leadId" = e."leadId"
      ${sameCampaign ? sql`AND p."campaignId" = e."campaignId"` : Prisma.empty}
      AND p."occurredAt" < ((${q.from}::date::timestamp AT TIME ZONE ${q.tz}) AT TIME ZONE 'UTC'))`;

function eventStatement(db: Db, ws: string, q: AnalyticsQuery) {
  const k = key(q.groupBy, q, {
    campaign: sql`e."campaignId"`,
    account: SENDER,
    step: sql`e."stepId"`,
    variant: sql`e."variantId"`,
    at: sql`e."occurredAt"`,
  });
  const human = sql`(e.meta->>'machine') IS DISTINCT FROM 'true'`;
  const person = sql`(e.meta->>'scanner') IS DISTINCT FROM 'true'`;
  const replies = q.includeAutoReplies
    ? sql`e.type IN ('REPLY', 'AUTO_REPLY')`
    : sql`e.type = 'REPLY'`;
  // the outer alias is `e` again, so health.ts's perLead and HARD_BOUNCE_SQL apply unchanged (D34)
  return db.$queryRaw<EventCounts[]>`
    SELECT e.k AS key, GROUPING(e.k) AS total,
      count(*) FILTER (WHERE e.type = 'ACCEPTED')::int AS sent,
      ${perLead(sql`e.first_c`)} AS contacted,
      ${perLead(sql`e.first_w`)} AS "newLeadsContacted",
      ${perLead(sql`e.type = 'ACCEPTED'`)} AS "leadsSent",
      ${perLead(sql`e.type = 'OPEN' AND ${human}`)} AS opened,
      count(*) FILTER (WHERE e.type = 'OPEN' AND ${human})::int AS opens,
      count(*) FILTER (WHERE e.type = 'OPEN' AND NOT ${human})::int AS "machineOpens",
      ${perLead(sql`e.type = 'CLICK' AND ${person}`)} AS clicked,
      count(*) FILTER (WHERE e.type = 'CLICK' AND ${person})::int AS clicks,
      count(DISTINCT e."scheduledMessageId") FILTER (WHERE e.type = 'CLICK' AND ${person})::int AS "clickedSends",
      ${perLead(replies)} AS replied,
      count(*) FILTER (WHERE ${replies})::int AS replies,
      ${perLead(sql`e.type = 'AUTO_REPLY'`)} AS "autoReplies",
      ${perLead(HARD_BOUNCE_SQL)} AS "hardBounced",
      ${perLead(sql`e.type = 'BOUNCE_SOFT'`)} AS "softBounced",
      ${perLead(sql`e.type = 'BOUNCE_UNKNOWN'`)} AS "unknownBounced",
      ${perLead(sql`e.type = 'COMPLAINT'`)} AS complaints,
      ${perLead(sql`e.type = 'UNSUBSCRIBE'`)} AS unsubscribed,
      count(*) FILTER (WHERE e.type = 'MEETING')::int AS meetings
    FROM (
      SELECT e.*, ${k} AS k, (${firstBefore(ws, q, true)}) AS first_c, (${firstBefore(ws, q, false)}) AS first_w
      FROM ${EVENT_FROM}
      WHERE ${eventScope(ws, q)} AND e.type IN ('ACCEPTED', 'OPEN', 'CLICK', 'REPLY', 'AUTO_REPLY', 'BOUNCE_HARD',
        'BOUNCE_SOFT', 'BOUNCE_UNKNOWN', 'SEND_FAILED', 'COMPLAINT', 'UNSUBSCRIBE', 'MEETING')
    ) e
    GROUP BY GROUPING SETS ((e.k), ())`;
}

export const OPP_FROM = (ws: string) => sql`"Opportunity" o
  LEFT JOIN "Lead" l ON l.id = o."leadId" AND l."workspaceId" = o."workspaceId"
  LEFT JOIN "Campaign" c ON c.id = o."campaignId" AND c."workspaceId" = ${ws}`;
/** Deals of the scope; analytics counts campaign deals only (Rev 2 M8), the CRM report every deal. */
export const oppScope = (ws: string, q: AnalyticsQuery, campaignOnly: boolean) =>
  sql`o."workspaceId" = ${ws} ${campaignOnly ? sql`AND o."campaignId" IS NOT NULL` : Prisma.empty}
    AND ${filters(q, { campaign: sql`o."campaignId"`, account: sql`o."accountId"`, lead: sql`o."leadId"` })}`;

/** Opportunities created in range (day = createdAt) and deals won in range (day = closedAt), attributed (Rev 2 I7). */
function oppStatement(db: Db, ws: string, q: AnalyticsQuery) {
  const k = (at: Prisma.Sql) =>
    key(q.groupBy, q, {
      campaign: sql`o."campaignId"`,
      account: sql`o."accountId"`,
      step: sql`o."stepId"`,
      variant: sql`o."variantId"`,
      at,
    });
  return db.$queryRaw<OppCounts[]>`
    SELECT o.k AS key, GROUPING(o.k) AS total,
      count(*) FILTER (WHERE NOT o.w)::int AS opportunities,
      COALESCE(sum(o.value) FILTER (WHERE NOT o.w), 0) AS "opportunityValue",
      count(*) FILTER (WHERE o.w)::int AS won,
      COALESCE(sum(o.value) FILTER (WHERE o.w), 0) AS "wonValue",
      COALESCE(sum(o."cashCollected") FILTER (WHERE o.w), 0) AS "cashCollected"
    FROM (
      SELECT false AS w, ${k(sql`o."createdAt"`)} AS k, o.value, o."cashCollected" FROM ${OPP_FROM(ws)}
      WHERE ${oppScope(ws, q, true)} AND ${inRange(sql`o."createdAt"`, q)}
      UNION ALL
      SELECT true, ${k(sql`o."closedAt"`)}, o.value, o."cashCollected" FROM ${OPP_FROM(ws)}
        JOIN "PipelineStage" s ON s.id = o."stageId" AND s.kind = 'WON'
      WHERE ${oppScope(ws, q, true)} AND ${inRange(sql`o."closedAt"`, q)}
    ) o
    GROUP BY GROUPING SETS ((o.k), ())`;
}

/** CampaignLeads COMPLETED in range (none, campaign, day and ESP views only). */
function completedStatement(db: Db, ws: string, q: AnalyticsQuery) {
  const k = key(q.groupBy, q, {
    campaign: sql`cl."campaignId"`,
    account: sql`NULL::text`,
    step: sql`NULL::text`,
    variant: sql`NULL::text`,
    at: sql`cl."completedAt"`,
  });
  return db.$queryRaw<(Grouped & { completed: number })[]>`
    SELECT x.k AS key, GROUPING(x.k) AS total, count(*)::int AS completed
    FROM (
      SELECT ${k} AS k FROM "CampaignLead" cl
        LEFT JOIN "Lead" l ON l.id = cl."leadId" AND l."workspaceId" = cl."workspaceId"
        LEFT JOIN "Campaign" c ON c.id = cl."campaignId" AND c."workspaceId" = cl."workspaceId"
      WHERE cl."workspaceId" = ${ws} AND cl.state = 'COMPLETED' AND ${inRange(sql`cl."completedAt"`, q)}
        AND ${filters(q, { campaign: sql`cl."campaignId"`, account: sql`cl."accountId"`, lead: sql`cl."leadId"` })}
    ) x
    GROUP BY GROUPING SETS ((x.k), ())`;
}

/** One lookup per entity: the display label of each key. */
async function labels(db: Db, ws: string, by: By, keys: string[]): Promise<Map<string, string>> {
  const deleted = (d: Date | null) => (d ? " (deleted)" : "");
  if (by === "campaign")
    return new Map(
      (
        await db.campaign.findMany({
          where: { workspaceId: ws, id: { in: keys } },
          select: { id: true, name: true, deletedAt: true },
        })
      ).map((c) => [c.id, c.name + deleted(c.deletedAt)]),
    );
  if (by === "account")
    return new Map(
      (
        await db.emailAccount.findMany({
          where: { workspaceId: ws, id: { in: keys } },
          select: { id: true, email: true },
        })
      ).map((a) => [a.id, a.email]),
    );
  if (by === "step")
    return new Map(
      (
        await db.sequenceStep.findMany({
          where: { id: { in: keys }, campaign: { workspaceId: ws } },
          select: { id: true, order: true, deletedAt: true },
        })
      ).map((s) => [s.id, `Step ${s.order}${deleted(s.deletedAt)}`]),
    );
  if (by === "variant")
    return new Map(
      (
        await db.stepVariant.findMany({
          where: { id: { in: keys }, step: { campaign: { workspaceId: ws } } },
          select: { id: true, label: true, step: { select: { order: true, deletedAt: true } } },
        })
      ).map((v) => [v.id, `Step ${v.step.order} ${v.label}${deleted(v.step.deletedAt)}`]),
    );
  return new Map(keys.map((k) => [k, k]));
}

const money = (d: Prisma.Decimal | number | undefined) => new Prisma.Decimal(d ?? 0).toFixed(2);
const div = (n: number, d: number) => (d ? n / d : null);
const NONE = "none"; // rows whose key is missing (a deal without attribution, an erased lead's ESP)

function metrics(
  q: AnalyticsQuery,
  perGroup: boolean,
  e: EventCounts | undefined,
  o: OppCounts | undefined,
  completed: number | null,
): Metrics {
  const ev: Partial<EventCounts> = e ?? {};
  const n = (x: number | undefined) => x ?? 0;
  const sent = n(ev.sent);
  const rateBase = q.replyBase === "sent" ? sent : perGroup ? n(ev.leadsSent) : n(ev.contacted);
  const replied = n(ev.replied);
  const opportunities = n(o?.opportunities);
  return {
    sent,
    contacted: n(ev.contacted),
    newLeadsContacted: n(ev.newLeadsContacted),
    rateBase,
    opened: n(ev.opened),
    opens: n(ev.opens),
    machineOpens: n(ev.machineOpens),
    clicked: n(ev.clicked),
    clicks: n(ev.clicks),
    clickedSends: n(ev.clickedSends),
    replied,
    replies: n(ev.replies),
    autoReplies: n(ev.autoReplies),
    hardBounced: n(ev.hardBounced),
    softBounced: n(ev.softBounced),
    unknownBounced: n(ev.unknownBounced),
    unsubscribed: n(ev.unsubscribed),
    complaints: n(ev.complaints),
    completed,
    meetings: n(ev.meetings),
    opportunities,
    opportunityValue: money(o?.opportunityValue),
    won: n(o?.won),
    wonValue: money(o?.wonValue),
    cashCollected: money(o?.cashCollected),
    rates: {
      open: div(n(ev.opened), rateBase),
      click: div(n(ev.clickedSends), sent),
      reply: div(replied, rateBase),
      positiveReply: div(opportunities, replied),
      bounce: div(n(ev.hardBounced), sent),
    },
  };
}

/**
 * D42 metrics for the range, as a total and one row per group (day rows zero-filled), from stored Events,
 * Opportunities and CampaignLeads only. Three or four statements whatever the number of groups.
 */
export async function analytics(
  db: Db,
  ws: string,
  q: AnalyticsQuery,
): Promise<{ total: Metrics; rows: (Metrics & { key: string; label: string })[] }> {
  const range = rangeKeys(q); // validates the range before any statement
  const days = q.groupBy === "day" ? range : null;
  const withCompleted = COMPLETED.includes(q.groupBy);
  const [ev, opp, done] = await checked(
    Promise.all([
      eventStatement(db, ws, q),
      oppStatement(db, ws, q),
      withCompleted ? completedStatement(db, ws, q) : Promise.resolve([]),
    ]),
  );
  const total = <T extends Grouped>(rows: T[]) => rows.find((r) => r.total === 1);
  const grouped = <T extends Grouped>(rows: T[]) =>
    new Map(rows.filter((r) => r.total === 0).map((r) => [r.key ?? NONE, r]));
  const [e, o, c] = [grouped(ev), grouped(opp), grouped(done)];
  const keys =
    q.groupBy === "none" ? [] : (days ?? [...new Set([...e.keys(), ...o.keys(), ...c.keys()])]);
  const label = await labels(
    db,
    ws,
    q.groupBy,
    keys.filter((k) => k !== NONE),
  );
  const perGroup = PER_GROUP.includes(q.groupBy);
  const rows = keys
    .map((k) => ({
      key: k,
      label: k === NONE ? "(none)" : (label.get(k) ?? k),
      ...metrics(
        q,
        perGroup,
        e.get(k),
        o.get(k),
        withCompleted ? (c.get(k)?.completed ?? 0) : null,
      ),
    }))
    .sort((a, b) => (days ? a.key.localeCompare(b.key) : a.label.localeCompare(b.label)));
  return {
    total: metrics(
      q,
      false,
      total(ev),
      total(opp),
      withCompleted ? (total(done)?.completed ?? 0) : null,
    ),
    rows,
  };
}
