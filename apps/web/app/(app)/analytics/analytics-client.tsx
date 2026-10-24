"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiAssist } from "../../../components/ai-assist";
import { Button } from "../../../components/ui/button";
import { call, errorText } from "../accounts/api-client";
import type { Member, Named } from "../leads/bulk-bar";
import { AccountsSection, BouncesSection, RevenueSection } from "./account-sections";
import { Charts } from "./charts";
import { Filters } from "./filters";
import { latest } from "./guards";
import { METRICS } from "./metrics-def";
import { MetricsTable } from "./metrics-table";
import { MetricMenu } from "./metric-menu";
import { Funnel, Tiles } from "./summary";
import { apiParams, todayIn } from "./query";
import { API, type Data, KEY, note, type VariantInfo } from "./report-ui";

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
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [variants, setVariants] = useState<Map<string, VariantInfo>>(new Map());
  const [toggleError, setToggleError] = useState("");
  const ids = sp.get("campaignIds")?.split(",").filter(Boolean) ?? [];
  const campaignId = ids.length === 1 ? ids[0]! : "";
  const base = sp.get("replyBase") === "sent" ? "sent" : "contacted";

  // today in the chosen zone and the stored metric choice are browser-only, so they load after mount
  useEffect(() => {
    // re-read every minute so a page left open past midnight does not keep yesterday
    const tick = () => setToday(todayIn(tz));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [tz]);
  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
    } catch {
      /* storage blocked: every metric stays shown */
    }
  }, []);
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
    // a newer filter aborts the older requests, so the server stops scanning for an answer nobody reads
    const ac = new AbortController();
    const get = async (path: string, extra = "") => {
      const r = await call(`${API}${path}?${query()}${extra}`, "GET", undefined, ac.signal);
      if (!r.ok) throw new Error(errorText(r));
      return r.json as never;
    };
    Promise.all([
      get("", "&groups=campaign,step,variant,day"), // one Event scan for the four tables
      get("/accounts"),
      get("/bounces"),
      get("/crm"),
    ])
      .then(([groups, accounts, bounces, revenue]) => {
        if (ac.signal.aborted) return;
        setError("");
        setData({
          ...(groups as Pick<Data, "campaign" | "step" | "variant" | "day">),
          accounts,
          bounces,
          revenue,
        });
      })
      .catch((e: Error) => !ac.signal.aborted && setError(e.message));
    return () => ac.abort();
  }, [query, today]);

  // variant ids -> their step, so the table can pause a variant (one campaign at a time)
  const variantSeq = useRef(latest());
  const loadVariants = useCallback(async () => {
    const seq = variantSeq.current.next(); // a slower answer for a campaign we have left is dropped
    if (!campaignId) return setVariants(new Map());
    const r = await call(`/api/v1/campaigns/${campaignId}/steps`, "GET");
    if (variantSeq.current.stale(seq)) return;
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
  const d = data;
  const total = d?.campaign.total;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <MetricMenu
          hidden={hidden}
          toggleMetric={toggleMetric}
          before={
            today && (
              <Button asChild variant="outline">
                <a href={`${API}/activity?${query()}`} download>
                  Export sending activity
                </a>
              </Button>
            )
          }
        />
      </div>

      {/* reserved height: the filter row mounts after the zone-dependent day is known */}
      <div className="min-h-28">
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
      </div>
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
          <Tiles total={total} shown={shown} base={base} />
          <Charts days={d.day.rows} variants={d.variant.rows} total={total} hidden={hidden} />
          <Funnel total={total} />

          <MetricsTable
            shown={shown}
            base={base}
            query={query}
            title="Campaigns"
            r={d.campaign}
            by="campaign"
          />
          <MetricsTable
            shown={shown}
            base={base}
            query={query}
            title="Steps"
            r={d.step}
            by="step"
            perGroup
          />
          <MetricsTable
            shown={shown}
            base={base}
            query={query}
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
          {campaignId && canEdit && (
            <AiAssist label="Analyze campaign" path="campaign-analysis" body={{ campaignId }} />
          )}
          {toggleError && (
            <p role="alert" className="text-sm text-red-600">
              {toggleError}
            </p>
          )}
          <MetricsTable
            shown={shown}
            base={base}
            query={query}
            title="By day"
            r={d.day}
            by="day"
            perGroup
          />

          <AccountsSection accounts={d.accounts} />
          <BouncesSection bounces={d.bounces} />
          <RevenueSection revenue={d.revenue} money={money} />
        </>
      )}
    </div>
  );
}
