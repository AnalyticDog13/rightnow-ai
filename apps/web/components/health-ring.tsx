import { cn } from "../lib/utils";

/** B4.23 display bands of a 0-100 health score (the score logic is unchanged). */
export function healthBand(score: number | null) {
  if (score === null) return { word: "Not enough data", color: "var(--neutral-solid)" };
  if (score >= 90) return { word: "Good", color: "var(--success-solid)" };
  if (score >= 70) return { word: "Fair", color: "var(--warning-solid)" };
  return { word: "Poor", color: "var(--danger-solid)" };
}

/**
 * B4.23 health ring: 32px (24 in dense rows), arc proportional to the score, number centered. `label` adds the band
 * word next to it. The ring's accessible name says the score and band.
 */
export function HealthRing({
  score,
  size = 32,
  label,
  className,
}: {
  score: number | null;
  size?: 24 | 32;
  /** show the band word; "wide" only from 1536px (where space allows, B4.23) */
  label?: boolean | "wide";
  className?: string;
}) {
  const band = healthBand(score);
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        role="img"
        aria-label={
          score === null
            ? "Health: not enough data"
            : `Health ${score} of 100, ${band.word.toLowerCase()}`
        }
        className="relative inline-grid shrink-0 place-items-center"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={3}
            stroke={score === null ? "var(--border-strong)" : "var(--surface-sunken)"}
            strokeDasharray={score === null ? "3 3" : undefined}
          />
          {score !== null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={3}
              stroke={band.color}
              strokeDasharray={`${(c * Math.max(0, Math.min(100, score))) / 100} ${c}`}
            />
          )}
        </svg>
        <span
          aria-hidden
          className={cn(
            "absolute font-mono font-medium tabular-nums",
            size === 32 ? "text-xs" : "text-[10px]",
          )}
        >
          {score ?? "-"}
        </span>
      </span>
      {label && (
        <span
          className={cn(
            "text-[13px]/[18px] whitespace-nowrap text-fg-muted",
            label === "wide" && "max-2xl:hidden",
          )}
        >
          {band.word}
        </span>
      )}
    </span>
  );
}
