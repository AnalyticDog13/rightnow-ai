"use client";

import { ChevronRight } from "lucide-react";
import { Line, LineChart, YAxis } from "recharts";
import { healthBand } from "../../../components/health-ring";

/** Health score history (HealthSnapshot) as a small line; the numbers are in the label for screen readers. */
export function HealthTrend({ trend }: { trend: { day: string; score: number }[] }) {
  if (trend.length < 2) return null;
  return (
    <div
      role="img"
      aria-label={`Health score, last ${trend.length} days: ${trend.map((t) => t.score).join(", ")}`}
      className="h-6 w-20"
    >
      {/* fixed size: a ResponsiveContainer measures 0 until layout and the line is tiny anyway */}
      <LineChart
        width={80}
        height={24}
        data={trend}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <YAxis hide domain={[0, 100]} />
        <Line
          type="linear"
          dataKey="score"
          stroke="var(--fg-muted)"
          strokeWidth={1.5}
          dot={(p: { cx?: number; cy?: number; index?: number }) =>
            // B4.23: only the last point, colored by its band
            p.index === trend.length - 1 ? (
              <circle
                key="last"
                cx={p.cx}
                cy={p.cy}
                r={2.5}
                fill={healthBand(trend.at(-1)!.score).color}
              />
            ) : (
              <g key={p.index} />
            )
          }
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}

/** The D34 terms, in the order and with the numbers of packages/core/src/deliverability/health.ts `healthScore`. */
export function HealthFormula() {
  return (
    <details className="group max-w-3xl rounded-lg border border-border bg-surface text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 text-fg-muted transition-transform duration-(--dur-2) group-open:rotate-90"
          aria-hidden
        />
        How the score is computed
      </summary>
      <ol className="mx-4 list-decimal border-t border-border pt-3 pl-5 text-fg-muted">
        <li>Start at 100. The result is rounded and kept between 0 and 100.</li>
        <li>
          Hard bounces, last 7 days: minus 10 for each percent of accepted sends (counted against at
          least 20 sends), at most 40.
        </li>
        <li>
          Soft bounces, last 7 days: minus 2 for each percent (at least 20 sends), at most 10.
        </li>
        <li>
          Complaints, last 30 days: minus 100 for each percent (counted against at least 1000
          sends), at most 30.
        </li>
        <li>Provider errors in 24 hours: minus 10 for 1 to 4, minus 20 for 5 or more.</li>
        <li>Mailbox sync failing (5 or more failures in a row): minus 20.</li>
        <li>Domain DNS: minus 25 when it blocks sending, minus 10 for a warning.</li>
        <li>
          Warm-up mail, last 14 days (only with 10 or more warm-up emails): minus 20 times the share
          that landed in spam.
        </li>
        <li>
          Latest inbox placement test: minus 20 times the share of seed mailboxes that did not reach
          the inbox.
        </li>
        <li>Only events after the account&apos;s last health reset count.</li>
      </ol>
      <p className="mx-4 mt-2 mb-4 text-fg-muted">
        An internal indicator, not a reputation guarantee.
      </p>
    </details>
  );
}
