"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Metrics } from "@rightnow/core";
import { METRICS, type Row } from "./metrics-def";

// colour-blind-safe; every series also has its own name in the legend and the data tables
const COLORS = ["#2563eb", "#d97706", "#059669", "#7c3aed", "#dc2626"];
const SERIES = ["sent", "opened", "clicked", "replied"];

function Figure({ title, table, children }: { title: string; table: string; children: ReactNode }) {
  return (
    <figure
      className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
      aria-label={title}
    >
      <figcaption className="text-sm font-medium">
        {title}{" "}
        <span className="font-normal text-muted-foreground">(figures in the {table} table)</span>
      </figcaption>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          {children as never}
        </ResponsiveContainer>
      </div>
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
  const shown = METRICS.filter((m) => SERIES.includes(m.id) && !hidden.includes(m.id));
  const volume = days.map((d) => ({
    day: d.key,
    ...Object.fromEntries(shown.map((m) => [m.label, m.count(d)])),
  }));
  const rates = days.map((d) => ({
    day: d.key,
    "Estimated open rate": pct(d.rates.open),
    "Reply rate": pct(d.rates.reply),
    "Bounce rate": pct(d.rates.bounce),
  }));
  const funnel = [
    ["Sent", total.sent],
    ["Replied", total.replied],
    ["Positive", total.opportunities],
    ["Meeting", total.meetings],
    ["Won (campaign)", total.won],
  ].map(([stage, n]) => ({ stage, n }));
  const ab = variants.map((v) => ({
    variant: v.label,
    "Reply rate": pct(v.rates.reply),
    Replied: v.replied,
  }));
  const axis = { tick: { fontSize: 12 }, stroke: "currentColor" };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Figure title="Volume over time" table="By day">
        <LineChart data={volume}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="day" {...axis} />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip />
          <Legend />
          {shown.map((m, i) => (
            <Line
              key={m.id}
              dataKey={m.label}
              stroke={COLORS[i]}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </Figure>
      <Figure title="Rates over time (%)" table="By day">
        <LineChart data={rates}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="day" {...axis} />
          <YAxis {...axis} />
          <Tooltip />
          <Legend />
          {["Estimated open rate", "Reply rate", "Bounce rate"].map((k, i) => (
            <Line key={k} dataKey={k} stroke={COLORS[i]} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </Figure>
      <Figure title="Funnel" table="Funnel list below">
        <BarChart data={funnel} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis type="number" allowDecimals={false} {...axis} />
          <YAxis type="category" dataKey="stage" width={70} {...axis} />
          <Tooltip />
          <Bar dataKey="n" name="Leads or sends" fill={COLORS[0]} isAnimationActive={false} />
        </BarChart>
      </Figure>
      <Figure title="Variants (A/B)" table="Variants">
        <BarChart data={ab}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="variant" {...axis} />
          <YAxis {...axis} />
          <Tooltip />
          <Legend />
          <Bar dataKey="Reply rate" fill={COLORS[0]} isAnimationActive={false} />
          <Bar dataKey="Replied" fill={COLORS[1]} isAnimationActive={false} />
        </BarChart>
      </Figure>
    </div>
  );
}

const pct = (r: number | null) => (r === null ? 0 : Math.round(r * 1000) / 10);
