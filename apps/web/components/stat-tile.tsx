import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "../lib/utils";
import { CapacityBar } from "./send-meter";
import { Sparkline } from "./sparkline";
import { StatusPill } from "./status-pill";
import { Card } from "./ui/card";

export type Delta = { value: number; unit: "%" | "pp"; better: "up" | "down"; base: string };

/**
 * B4.5 KPI tile. `title` is the tooltip (denominator or caveat) and stays visible as text; `note` is the hint
 * under the value. Optional: `of` renders " / 300" after the value, `delta` a change chip ("thin" = the base had
 * fewer than 20 sends), `trend` a sparkline (3+ points), `variant="meter"` a capacity bar for value/of.
 */
export function StatTile({
  label,
  value,
  title,
  note,
  of,
  delta,
  thin,
  trend,
  variant,
  className,
}: {
  label: string;
  value: string;
  title?: string;
  note?: string;
  of?: number | string;
  delta?: Delta;
  thin?: boolean;
  trend?: number[];
  variant?: "meter";
  className?: string;
}) {
  return (
    <Card
      className={cn("flex min-h-26 flex-col gap-1 p-4 xl:p-5", className)}
      role="group"
      aria-label={label}
      title={title}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1 text-[13px]/[18px] text-fg-muted">
          {label}
          {title && <Info className="size-3.5 text-fg-subtle" aria-hidden />}
        </p>
        {trend && trend.length >= 3 && <Sparkline label={label} values={trend} />}
      </div>
      <p className="text-[28px]/8 font-semibold tracking-[-0.01em] tabular-nums">
        {value}
        {of !== undefined && (
          <span className="text-base font-normal tracking-normal text-fg-muted"> / {of}</span>
        )}
      </p>
      {variant === "meter" && of !== undefined && (
        <CapacityBar sent={Number(value)} max={Number(of)} className="my-1" />
      )}
      {delta && <DeltaChip delta={delta} thin={thin} />}
      {note && <p className="text-[13px]/[18px] text-fg-subtle">{note}</p>}
      {/* the tooltip text, also on the page for keyboard and touch users */}
      {title && <p className="text-[13px]/[18px] text-fg-subtle">{title}</p>}
    </Card>
  );
}

function DeltaChip({ delta: d, thin }: { delta: Delta; thin?: boolean }) {
  if (thin)
    return (
      <StatusPill tone="neutral" size="sm" className="self-start">
        Not enough data
      </StatusPill>
    );
  const up = d.value >= 0;
  const flat = Math.abs(d.value) < 0.5;
  const tone = flat ? "neutral" : up === (d.better === "up") ? "success" : "danger";
  const text = `${Math.abs(d.value).toFixed(1)}${d.unit === "%" ? "%" : " pp"} vs ${d.base}`;
  return (
    <StatusPill tone={tone} size="sm" icon={up ? TrendingUp : TrendingDown} className="self-start">
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span aria-hidden>{text}</span>
      <span className="sr-only">
        {up ? "up" : "down"} {text.replace(" vs ", " versus ")}
      </span>
    </StatusPill>
  );
}

export const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);
