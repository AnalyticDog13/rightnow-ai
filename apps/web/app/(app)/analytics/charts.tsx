"use client";

import type { Metrics } from "@rightnow/core";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { METRICS, type Row } from "./metrics-def";

// B2.4: fixed series colors from CSS variables (dark mode follows), each also with its own dash or name
const SERIES: Record<string, { color: string; dash?: string }> = {
  sent: { color: "var(--chart-1)" },
  opened: { color: "var(--chart-5)", dash: "4 3" },
  clicked: { color: "var(--chart-3)" },
  replied: { color: "var(--chart-2)" },
};
const RATES = [
  { key: "Estimated open rate", color: "var(--chart-5)", dash: "4 3" },
  { key: "Reply rate", color: "var(--chart-2)" },
  { key: "Bounce rate", color: "var(--danger-solid)" },
];
const axis = {
  axisLine: false,
  tickLine: false,
  tick: { fill: "var(--chart-axis)", fontSize: 12 },
} as const;
const grid = <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />;
/** "2026-10-03" -> "Oct 3" (the day keys are already in the chosen zone). */
const day = (k: string) =>
  /^\d{4}-\d\d-\d\d$/.test(k)
    ? new Date(`${k}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : k;

type Item = { label: string; color: string; dash?: string };

function Legend({ items }: { items: Item[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-hidden>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[13px]/[18px] text-fg-muted">
          <span
            className="size-2 rounded-[2px]"
            style={i.dash ? { border: `1.5px dashed ${i.color}` } : { background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** B4.16 tooltip: elevated surface, date in micro, one row per series with a swatch. */
function Tip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-elevated px-2.5 py-2 text-[13px]/[18px] shadow-e2">
      <p className="micro mb-1 text-fg-muted">{day(String(label))}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2 rounded-[2px]" style={{ background: p.color }} aria-hidden />
          <span className="flex-1">{p.name}</span>
          <span className="pl-3 font-medium tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/** One chart card: title + legend, the plot as an image with a summary, and the full data as a table. */
function Figure({
  title,
  summary,
  legend,
  heads,
  rows,
  children,
}: {
  title: string;
  summary: string;
  legend?: Item[];
  heads: string[];
  rows: (string | number)[][];
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <figcaption className="text-base font-semibold">{title}</figcaption>
        {legend && <Legend items={legend} />}
      </div>
      <div role="img" aria-label={summary} className="h-50 md:h-60">
        <ResponsiveContainer width="100%" height="100%">
          {children as never}
        </ResponsiveContainer>
      </div>
      <details className="text-[13px]/[18px]">
        <summary className="cursor-pointer text-signal hover:underline">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-sunken">
              <tr>
                {heads.map((h) => (
                  <th key={h} scope="col" className="micro px-3 py-1.5 font-medium text-fg-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-1.5">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export function Charts({
  days,
  variants,
  total,
  hidden,
}: {
  days: Row[];
  variants: Row[];
  total: Metrics;
  hidden: string[];
}) {
  const shown = METRICS.filter((m) => m.id in SERIES && !hidden.includes(m.id));
  const label = (m: (typeof shown)[number]) =>
    m.id === "opened" ? `${m.label} (estimated)` : m.label;
  const volume = days.map((d) => ({
    day: d.key,
    ...Object.fromEntries(shown.map((m) => [label(m), m.count(d)])),
  }));
  const rates = days.map((d) => ({
    day: d.key,
    "Estimated open rate": pct(d.rates.open),
    "Reply rate": pct(d.rates.reply),
    "Bounce rate": pct(d.rates.bounce),
  }));
  const stages = [
    ["Sent", total.sent],
    ["Replied", total.replied],
    ["Positive", total.opportunities],
    ["Meeting", total.meetings],
    ["Won (campaign)", total.won],
  ] as const;
  const top = Math.max(total.sent, 1);
  // value + percent of the previous stage at the bar end; the pale remainder runs to Sent
  const funnel = stages.map(([stage, n], i) => ({
    stage,
    n,
    rest: Math.max(0, top - n),
    tag: i ? `${n} · ${ofPrev(n, stages[i - 1]![1])}` : String(n),
  }));
  const ab = variants.map((v) => ({
    variant: v.label,
    "Reply rate": pct(v.rates.reply),
    Replied: v.replied,
  }));
  const range = days.length ? `${day(days[0]!.key)} to ${day(days.at(-1)!.key)}` : "no days";
  const list = (key: string) => volume.map((v) => (v as Record<string, unknown>)[key]).join(", ");
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Figure
        title="Volume over time"
        summary={`Volume per day, ${range}. ${shown.map((m) => `${label(m)}: ${list(label(m))}`).join(". ")}`}
        legend={shown.map((m) => ({ label: label(m), ...SERIES[m.id]! }))}
        heads={["Day", ...shown.map(label)]}
        rows={volume.map((v) => [day(v.day), ...shown.map((m) => Number((v as never)[label(m)]))])}
      >
        <AreaChart data={volume} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            {shown.map((m) => (
              <linearGradient key={m.id} id={`fill-${m.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES[m.id]!.color} stopOpacity={0.16} />
                <stop offset="100%" stopColor={SERIES[m.id]!.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {grid}
          <XAxis dataKey="day" tickFormatter={day} {...axis} minTickGap={16} />
          <YAxis allowDecimals={false} width={40} tickCount={5} {...axis} />
          <Tooltip content={<Tip />} cursor={{ stroke: "var(--border-strong)" }} />
          {shown.map((m) => (
            <Area
              key={m.id}
              type="monotone"
              dataKey={label(m)}
              stroke={SERIES[m.id]!.color}
              strokeDasharray={SERIES[m.id]!.dash}
              strokeWidth={2}
              fill={`url(#fill-${m.id})`}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </Figure>
      <Figure
        title="Rates over time (%)"
        summary={`Rates per day in percent, ${range}. ${RATES.map((r) => `${r.key}: ${rates.map((x) => x[r.key as keyof typeof x]).join(", ")}`).join(". ")}`}
        legend={RATES.map((r) => ({ label: r.key, color: r.color, dash: r.dash }))}
        heads={["Day", ...RATES.map((r) => `${r.key} (%)`)]}
        rows={rates.map((r) => [
          day(r.day),
          r["Estimated open rate"],
          r["Reply rate"],
          r["Bounce rate"],
        ])}
      >
        <LineChart data={rates} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          {grid}
          <XAxis dataKey="day" tickFormatter={day} {...axis} minTickGap={16} />
          <YAxis width={40} tickCount={5} {...axis} />
          <Tooltip content={<Tip />} cursor={{ stroke: "var(--border-strong)" }} />
          {RATES.map((r) => (
            <Line
              key={r.key}
              type="monotone"
              dataKey={r.key}
              stroke={r.color}
              strokeDasharray={r.dash}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </Figure>
      <Figure
        title="Funnel"
        summary={`Funnel: ${stages.map(([s, n]) => `${s} ${n}`).join(", ")}`}
        heads={["Stage", "Leads or sends", "% of previous"]}
        rows={stages.map(([s, n], i) => [s, n, i ? ofPrev(n, stages[i - 1]![1]) : "-"])}
      >
        <BarChart
          data={funnel}
          layout="vertical"
          barCategoryGap={4}
          margin={{ top: 0, right: 48, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide domain={[0, top]} />
          <YAxis type="category" dataKey="stage" width={104} {...axis} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--hover)" }} />
          <Bar
            dataKey="n"
            name="Leads or sends"
            stackId="f"
            fill="var(--chart-1)"
            maxBarSize={24}
            isAnimationActive={false}
          >
            <LabelList dataKey="tag" position="right" fill="var(--fg)" fontSize={12} />
          </Bar>
          <Bar
            dataKey="rest"
            name="Remainder"
            stackId="f"
            fill="var(--surface-sunken)"
            radius={[0, 3, 3, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </Figure>
      <Figure
        title="Variants (A/B)"
        summary={`Variants: ${ab.map((v) => `${v.variant} reply rate ${v["Reply rate"]}%, ${v.Replied} replied`).join("; ") || "none"}`}
        legend={[
          { label: "Reply rate", color: "var(--chart-2)" },
          { label: "Replied", color: "var(--chart-4)" },
        ]}
        heads={["Variant", "Reply rate (%)", "Replied"]}
        rows={ab.map((v) => [v.variant, v["Reply rate"], v.Replied])}
      >
        <BarChart data={ab} barGap={4} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          {grid}
          <XAxis dataKey="variant" {...axis} />
          <YAxis width={40} tickCount={5} {...axis} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--hover)" }} />
          <Bar
            dataKey="Reply rate"
            fill="var(--chart-2)"
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
          <Bar
            dataKey="Replied"
            fill="var(--chart-4)"
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </Figure>
    </div>
  );
}

const pct = (r: number | null) => (r === null ? 0 : Math.round(r * 1000) / 10);
const ofPrev = (n: number, prev: number) => (prev ? `${Math.round((n / prev) * 1000) / 10}%` : "-");
