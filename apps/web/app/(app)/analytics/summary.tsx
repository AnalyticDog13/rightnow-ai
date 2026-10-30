import type { Metrics } from "@rightnow/core";
import { pct, StatTile } from "../../../components/stat-tile";
import { METRICS, SENT_TIP } from "./metrics-def";
import { note, Section } from "./report-ui";

export function Tiles({
  total,
  shown,
  base,
}: {
  total: Metrics;
  shown: typeof METRICS;
  base: string;
}) {
  return (
    <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
      {shown.map((m) => {
        const rate = m.rate?.(total, base);
        return (
          <StatTile
            key={m.id}
            label={m.label}
            value={String(m.count(total))}
            title={m.id === "sent" ? SENT_TIP : rate?.tip}
            note={
              rate && `${m.id === "opened" ? "Estimated: " : ""}${pct(rate.value)} ${rate.label}`
            }
          />
        );
      })}
    </div>
  );
}

export function Funnel({ total }: { total: Metrics }) {
  return (
    <Section title="Funnel">
      <p className={note}>
        Positive and Won count campaign deals only; Revenue below counts every deal.
      </p>
      <ol className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 md:p-5">
        {(
          [
            ["Sent", total.sent],
            ["Replied", total.replied],
            ["Positive", total.opportunities],
            ["Meeting", total.meetings],
            ["Won (campaign deals)", total.won],
          ] as const
        ).map(([k, n], i, all) => {
          const prev = i ? all[i - 1]![1] : 0;
          return (
            <li
              key={k}
              className="grid grid-cols-[8rem_1fr] items-center gap-3 text-sm max-md:grid-cols-1 max-md:gap-1"
            >
              <span>
                {k}: <span className="font-medium tabular-nums">{n}</span>
                {i > 0 && (
                  <span className="text-[13px]/[18px] text-fg-subtle tabular-nums">
                    {" "}
                    · {prev ? `${Math.round((n / prev) * 1000) / 10}%` : "-"}
                  </span>
                )}
              </span>
              {/* the bar repeats the number above; the pale remainder runs to Sent */}
              <span aria-hidden className="h-3 overflow-hidden rounded-xs bg-sunken">
                <span
                  className="block h-full rounded-xs bg-chart-1"
                  style={{ width: `${total.sent ? Math.min(100, (n / total.sent) * 100) : 0}%` }}
                />
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
