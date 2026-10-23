import { Prisma, type PrismaClient } from "@rightnow/db/client";
import { csvCell } from "../leads/export";
import type { analytics, Metrics } from "./metrics";
import { type AnalyticsQuery, checked, EVENT_FROM, eventScope, rangeDays, SENDER } from "./query";

type Db = PrismaClient | Prisma.TransactionClient;
const sql = Prisma.sql;
const line = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";
const PAGE = 500;

type Row = {
  id: string;
  at: Date;
  action: string;
  lead: string | null;
  account: string | null;
  campaign: string | null;
  step: number | null;
  variant: string | null;
  link: string | null;
  flags: string;
};

/**
 * PS-ANALYTICS-16: every counted Event of the scope (the same eventScope as the metrics), oldest first, keyset on
 * (occurredAt, id), one chunk per page of 500. Machine opens and scanner clicks are flagged, never dropped.
 */
export async function* exportActivityCsv(
  db: Db,
  ws: string,
  q: AnalyticsQuery,
): AsyncIterable<string> {
  rangeDays(q);
  yield line([
    "date",
    "action",
    "lead_email",
    "account",
    "campaign",
    "step",
    "variant",
    "link",
    "flags",
  ]);
  let after: Row | undefined;
  for (;;) {
    const rows: Row[] = await checked(db.$queryRaw<Row[]>`
      SELECT e.id, e."occurredAt" AS at, e.type::text AS action, l.email AS lead, a.email AS account,
        c.name AS campaign, st."order" AS step, v.label AS variant, e.meta->>'url' AS link,
        concat_ws(';', CASE WHEN e.meta->>'machine' = 'true' THEN 'machine' END,
          CASE WHEN e.meta->>'scanner' = 'true' THEN 'scanner' END) AS flags
      FROM ${EVENT_FROM}
        LEFT JOIN "EmailAccount" a ON a.id = ${SENDER} AND a."workspaceId" = e."workspaceId"
        LEFT JOIN "SequenceStep" st ON st.id = e."stepId" AND st."campaignId" = e."campaignId"
        LEFT JOIN "StepVariant" v ON v.id = e."variantId" AND v."stepId" = e."stepId"
      WHERE ${eventScope(ws, q)}
        ${after ? sql`AND (e."occurredAt", e.id) > (${after.at.toISOString()}::timestamp, ${after.id})` : Prisma.empty}
      ORDER BY e."occurredAt", e.id
      LIMIT ${PAGE}`);
    if (rows.length)
      yield rows
        .map((r) =>
          line([r.at, r.action, r.lead, r.account, r.campaign, r.step, r.variant, r.link, r.flags]),
        )
        .join("");
    if (rows.length < PAGE) return;
    after = rows.at(-1);
  }
}

const FIELDS = [
  ...["sent", "contacted", "newLeadsContacted", "rateBase", "opened", "opens", "machineOpens"],
  ...["clicked", "clicks", "clickedSends", "replied", "replies", "autoReplies", "hardBounced"],
  ...["softBounced", "unknownBounced", "unsubscribed", "complaints", "completed", "meetings"],
  ...["opportunities", "opportunityValue", "won", "wonValue", "cashCollected"],
] as const satisfies readonly (keyof Metrics)[];
const RATES = ["open", "click", "reply", "positiveReply", "bounce"] as const;

/** The metrics table as CSV: one row per group, then the total; cells escaped by csvCell (CSV injection). */
export function metricsCsv(r: Awaited<ReturnType<typeof analytics>>): string {
  const row = (key: string, label: string, m: Metrics) =>
    line([key, label, ...FIELDS.map((f) => m[f]), ...RATES.map((k) => m.rates[k])]);
  return (
    line(["key", "label", ...FIELDS, ...RATES.map((k) => `rate_${k}`)]) +
    r.rows.map((x) => row(x.key, x.label, x)).join("") +
    row("total", "Total", r.total)
  );
}
