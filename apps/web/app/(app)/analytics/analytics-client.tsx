"use client";

import type { Metrics } from "@rightnow/core";
import { Settings2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { pct, StatTile } from "../../../components/stat-tile";
import { Button } from "../../../components/ui/button";
import { call, errorText } from "../accounts/api-client";
import type { Member, Named } from "../leads/bulk-bar";
import { Charts } from "./charts";
import { Filters } from "./filters";
import { CONTACTED_NOTE, METRICS, type Row, SENT_TIP } from "./metrics-def";
import { apiParams, csvText, rateTip, todayIn } from "./query";

type Report = { total: Metrics; rows: Row[] };
type Acct = {
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
};
type Bounces = {
  hard: number;
  soft: number;
  unknown: number;
  reasons: { type: string; reason: string; count: number }[];
};
type Revenue = {
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
};
type Data = {
  campaign: Report;
  step: Report;
  variant: Report;
  day: Report;
  accounts: Acct[];
  bounces: Bounces;
  revenue: Revenue;
};
type VariantInfo = { campaignId: string; stepId: string; active: boolean };

const KEY = "analytics.hiddenMetrics";
const API = "/api/v1/analytics";
const th = "px-2 py-1 text-left font-medium";
const td = "px-2 py-1 tabular-nums";
const note = "text-xs text-muted-foreground";

function download(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = `s-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-medium">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const CsvFile = ({ name, rows }: { name: string; rows: unknown[][] }) => (
  <Button variant="outline" onClick={() => download(name, rows)}>
    Download CSV
  </Button>
);

function Table({
  caption,
  heads,
  children,
}: {
  caption: string;
  heads: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted">
          <tr>
            {heads.map((h, i) => (
              <th key={i} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function AnalyticsClient({
  campaigns,
  accounts,
  lists,
  members,
  timezone,
  currency,
  canEdit,
}: {
  campaigns: Named[];
  accounts: Named[];
  lists: Named[];
  members: Member[];
  timezone: string;
  currency: string;
  canEdit: boolean;
}) {
  const sp = useSearchParams();
  const qs = sp.toString();
  const tz = sp.get("tz") || "UTC";
  const [today, setToday] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [variants, setVariants] = useState<Map<string, VariantInfo>>(new Map());
  const [toggleError, setToggleError] = useState("");
  const ids = sp.get("campaignIds")?.split(",").filter(Boolean) ?? [];
  const campaignId = ids.length === 1 ? ids[0]! : "";
  const base = sp.get("replyBase") === "sent" ? "sent" : "contacted";

  // today in the chosen zone and the stored metric choice are browser-only, so they load after mount
  useEffect(() => {
    setToday(todayIn(tz));
  }, [tz]);
  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
    } catch {
      /* storage blocked: every metric stays shown */
    }
  }, []);
  // the metric menu closes on an outside click; Escape (below) also returns focus to its button
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!menuBox.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);
  function toggleMetric(id: string, on: boolean) {
    const next = on ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* the choice then lasts until the page closes */
    }
  }

  const query = useCallback(
    (groupBy?: string) => apiParams(new URLSearchParams(qs), { tz, today }, groupBy),
    [qs, tz, today],
  );

  useEffect(() => {
    if (!today) return;
    let stale = false;
    const get = async (path: string, by?: string) => {
      const r = await call(`${API}${path}?${query(by)}`, "GET");
      if (!r.ok) throw new Error(errorText(r));
      return r.json as never;
    };
    Promise.all([
      get("", "campaign"),
      get("", "step"),
      get("", "variant"),
      get("", "day"),
      get("/accounts"),
      get("/bounces"),
      get("/crm"),
    ])
      .then(([campaign, step, variant, day, accounts, bounces, revenue]) => {
        if (stale) return;
        setError("");
        setData({ campaign, step, variant, day, accounts, bounces, revenue });
      })
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [query, today]);

  // variant ids -> their step, so the table can pause a variant (one campaign at a time)
  const variantSeq = useRef(0);
  const loadVariants = useCallback(async () => {
    const seq = ++variantSeq.current; // a slower answer for a campaign we have left is dropped
    if (!campaignId) return setVariants(new Map());
    const r = await call(`/api/v1/campaigns/${campaignId}/steps`, "GET");
    if (seq !== variantSeq.current) return;
    const steps = (r.json.steps ?? []) as {
      id: string;
      variants: { id: string; active: boolean }[];
    }[];
    setVariants(
      new Map(
        steps.flatMap((s) =>
          s.variants.map((v) => [v.id, { campaignId, stepId: s.id, active: v.active }] as const),
        ),
      ),
    );
  }, [campaignId]);
  useEffect(() => void loadVariants(), [loadVariants]);

  async function setActive(id: string, v: VariantInfo, active: boolean) {
    setToggleError("");
    const r = await call(
      `/api/v1/campaigns/${v.campaignId}/steps/${v.stepId}/variants/${id}`,
      "PATCH",
      { active },
    );
    if (!r.ok) setToggleError(errorText(r));
    await loadVariants();
  }

  const shown = METRICS.filter((m) => !hidden.includes(m.id));
  const money = (v: string | null) =>
    v === null
      ? "n/a"
      : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(v));

  /** One metrics table (campaigns, steps, variants, days) with its total row and CSV. */
  function MetricsTable({
    title,
    r,
    by,
    perGroup,
    extra,
  }: {
    title: string;
    r: Report;
    by: string;
    perGroup?: boolean;
    extra?: { head: string; cell: (row: Row) => ReactNode };
  }) {
    const b = perGroup ? (base === "sent" ? "sent" : "leads sent") : base;
    const cell = (m: Metrics, d: (typeof METRICS)[number]) => {
      const rate = d.rate?.(m, b);
      return (
        <td key={d.id} className={td} title={rate?.tip}>
          {d.count(m)}
          {rate && ` (${pct(rate.value)})`}
          {rate && <span className="sr-only"> {rate.tip}</span>}
        </td>
      );
    };
    return (
      <Section
        title={title}
        action={
          <Button asChild variant="outline">
            <a href={`${API}?${query(by)}&format=csv`} download>
              Download CSV
            </a>
          </Button>
        }
      >
        <Table
          caption={title}
          heads={[
            "Name",
            ...(extra ? [extra.head] : []),
            ...shown.map((d) => (
              <span
                key={d.id}
                title={
                  d.id === "sent" ? SENT_TIP : d.id === "contacted" ? CONTACTED_NOTE : undefined
                }
              >
                {d.label}
              </span>
            )),
          ]}
        >
          {r.rows.map((row) => (
            <tr key={row.key} className="border-t border-border">
              <th scope="row" className={`${th} font-normal`}>
                {row.label}
              </th>
              {extra && <td className={td}>{extra.cell(row)}</td>}
              {shown.map((d) => cell(row, d))}
            </tr>
          ))}
          <tr className="border-t border-border bg-muted font-medium">
            <th scope="row" className={th}>
              Total
            </th>
            {extra && <td />}
            {shown.map((d) => cell(r.total, d))}
          </tr>
        </Table>
        <p className={note}>{CONTACTED_NOTE}</p>
      </Section>
    );
  }

  const d = data;
  const total = d?.campaign.total;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <div
          ref={menuBox}
          className="relative flex gap-2"
          onKeyDown={(e) => {
            if (e.key !== "Escape" || !menu) return;
            setMenu(false);
            menuButton.current?.focus();
          }}
        >
          {today && (
            <Button asChild variant="outline">
              <a href={`${API}/activity?${query()}`} download>
                Export sending activity
              </a>
            </Button>
          )}
          <Button
            ref={menuButton}
            variant="outline"
            aria-expanded={menu}
            aria-controls="metric-menu"
            onClick={() => setMenu(!menu)}
          >
            <Settings2 className="size-4" aria-hidden /> Metrics
          </Button>
          {menu && (
            <fieldset
              id="metric-menu"
              className="absolute right-0 top-12 z-10 flex flex-col gap-1 rounded-md border border-border bg-card p-3 text-sm shadow-md"
            >
              <legend className="px-1 font-medium">Show metrics</legend>
              {METRICS.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(m.id)}
                    onChange={(e) => toggleMetric(m.id, e.target.checked)}
                  />
                  {m.label}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </div>

      {today && (
        <Filters
          campaigns={campaigns}
          accounts={accounts}
          lists={lists}
          members={members}
          timezone={timezone}
          today={today}
        />
      )}
      <p className={note}>
        Days are calendar days in {tz}
        {today && `, ${query().get("from")} to ${query().get("to")}`}.
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!d && !error && <p role="status">Loading analytics</p>}

      {d && total && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((m) => {
              const rate = m.rate?.(total, base);
              return (
                <StatTile
                  key={m.id}
                  label={m.label}
                  value={String(m.count(total))}
                  title={m.id === "sent" ? SENT_TIP : rate?.tip}
                  note={
                    rate &&
                    `${m.id === "opened" ? "Estimated: " : ""}${pct(rate.value)} ${rate.label}`
                  }
                />
              );
            })}
          </div>

          <Charts days={d.day.rows} variants={d.variant.rows} total={total} hidden={hidden} />
          <Section title="Funnel">
            <ol className="flex flex-wrap gap-x-6 text-sm">
              {(
                [
                  ["Sent", total.sent],
                  ["Replied", total.replied],
                  ["Positive", total.opportunities],
                  ["Meeting", total.meetings],
                  ["Won", total.won],
                ] as const
              ).map(([k, n]) => (
                <li key={k}>
                  {k}: {n}
                </li>
              ))}
            </ol>
          </Section>

          <MetricsTable title="Campaigns" r={d.campaign} by="campaign" />
          <MetricsTable title="Steps" r={d.step} by="step" perGroup />
          <MetricsTable
            title="Variants"
            r={d.variant}
            by="variant"
            perGroup
            extra={
              campaignId
                ? {
                    head: "Active",
                    cell: (row) => {
                      const v = variants.get(row.key);
                      return v ? (
                        <input
                          type="checkbox"
                          aria-label={`${row.label} active`}
                          checked={v.active}
                          disabled={!canEdit}
                          onChange={(e) => void setActive(row.key, v, e.target.checked)}
                        />
                      ) : null;
                    },
                  }
                : undefined
            }
          />
          <p className={note}>
            Use at least 3 months of data before pausing a variant.
            {!campaignId && " Filter to a single campaign to pause or resume variants here."}
          </p>
          {toggleError && (
            <p role="alert" className="text-sm text-red-600">
              {toggleError}
            </p>
          )}
          <MetricsTable title="By day" r={d.day} by="day" perGroup />

          <Section
            title="Email accounts"
            action={
              <CsvFile
                name="accounts.csv"
                rows={[
                  [
                    "account",
                    "sent",
                    "contacted",
                    "opened",
                    "replied",
                    "reply_rate",
                    "health",
                    "remaining_today",
                  ],
                  ...d.accounts.map((a) => [
                    a.email,
                    a.sent,
                    a.contacted,
                    a.opened,
                    a.replied,
                    a.replyRate,
                    a.healthScore,
                    a.remainingToday,
                  ]),
                ]}
              />
            }
          >
            <Table
              caption="Email accounts"
              heads={[
                "Account",
                "Sent",
                <span key="c" title={CONTACTED_NOTE}>
                  Contacted
                </span>,
                "Opened",
                "Replied",
                "Reply rate",
                "Health",
                "Health trend",
                "Remaining today",
              ]}
            >
              {d.accounts.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <th scope="row" className={`${th} font-normal`}>
                    {a.email}
                  </th>
                  <td className={td}>{a.sent}</td>
                  <td className={td}>{a.contacted}</td>
                  <td className={td}>{a.opened}</td>
                  <td className={td}>{a.replied}</td>
                  <td className={td} title={rateTip(a.replied, a.sent, "sent")}>
                    {pct(a.replyRate)}
                  </td>
                  <td className={td}>{a.healthScore ?? "n/a"}</td>
                  <td className={td} title={a.trend.map((t) => `${t.day}: ${t.score}`).join(", ")}>
                    {a.trend.length > 1
                      ? `${a.trend[0]!.score} to ${a.trend.at(-1)!.score}`
                      : "n/a"}
                  </td>
                  <td className={td}>{a.remainingToday}</td>
                </tr>
              ))}
            </Table>
            <p className={note}>{CONTACTED_NOTE}</p>
          </Section>

          <Section
            title="Bounces"
            action={
              <CsvFile
                name="bounces.csv"
                rows={[
                  ["type", "reason", "count"],
                  ...d.bounces.reasons.map((x) => [x.type, x.reason, x.count]),
                ]}
              />
            }
          >
            <p className="text-sm">
              Hard {d.bounces.hard}, soft {d.bounces.soft}, unknown {d.bounces.unknown} leads.
            </p>
            <Table caption="Top bounce and failure reasons" heads={["Type", "Reason", "Count"]}>
              {d.bounces.reasons.map((x) => (
                <tr key={`${x.type}${x.reason}`} className="border-t border-border">
                  <td className={td}>{x.type}</td>
                  <td className={td}>{x.reason}</td>
                  <td className={td}>{x.count}</td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section
            title="Revenue"
            action={
              <CsvFile
                name="revenue.csv"
                rows={[
                  ["campaign", "won", "cash_collected"],
                  ...d.revenue.revenueByCampaign.map((x) => [x.name, x.won, x.cashCollected]),
                ]}
              />
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Pipeline (current)"
                value={money(d.revenue.pipelineValue)}
                note={`${d.revenue.openCount} open deals`}
              />
              <StatTile label="Average deal size" value={money(d.revenue.avgDealSize)} />
              <StatTile label="Won in range" value={money(d.revenue.wonValue)} />
              <StatTile label="Cash collected" value={money(d.revenue.cashCollected)} />
              <StatTile label="Annualized closed" value={money(d.revenue.annualizedClosed)} />
              <StatTile label="Revenue per lead" value={money(d.revenue.revenuePerLead)} />
            </div>
            <Table
              caption="Conversion by current stage"
              heads={["Conversion by current stage", "Deals", "Reached"]}
            >
              {d.revenue.conversionByStage.map((s) => (
                <tr key={s.stageId} className="border-t border-border">
                  <th scope="row" className={`${th} font-normal`}>
                    {s.name}
                  </th>
                  <td className={td}>{s.count}</td>
                  <td className={td}>{pct(s.reachedPct)}</td>
                </tr>
              ))}
            </Table>
            <Table caption="Revenue by campaign" heads={["Campaign", "Won", "Cash collected"]}>
              {d.revenue.revenueByCampaign.map((c) => (
                <tr key={c.campaignId ?? "none"} className="border-t border-border">
                  <th scope="row" className={`${th} font-normal`}>
                    {c.name}
                  </th>
                  <td className={td}>{c.won}</td>
                  <td className={td}>{money(c.cashCollected)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}
    </div>
  );
}
