"use client";

import { Line, LineChart, YAxis } from "recharts";

/** B4.5 64x24 sparkline without axes; the values are in the label for screen readers. */
export function Sparkline({ label, values }: { label: string; values: number[] }) {
  return (
    <div role="img" aria-label={`${label}, trend: ${values.join(", ")}`} className="h-6 w-16">
      <LineChart
        width={64}
        height={24}
        data={values.map((v) => ({ v }))}
        margin={{ top: 3, right: 3, bottom: 3, left: 3 }}
      >
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line
          dataKey="v"
          stroke="var(--fg-muted)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
