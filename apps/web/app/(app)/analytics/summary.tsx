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
      <ol className="flex flex-wrap gap-x-6 text-sm">
        {(
          [
            ["Sent", total.sent],
            ["Replied", total.replied],
            ["Positive", total.opportunities],
            ["Meeting", total.meetings],
            ["Won (campaign deals)", total.won],
          ] as const
        ).map(([k, n]) => (
          <li key={k}>
            {k}: {n}
          </li>
        ))}
      </ol>
    </Section>
  );
}
