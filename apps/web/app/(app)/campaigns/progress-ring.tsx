/** B4.23 campaign progress ring: 28px, completed / total leads, percent in mono 10. Decorative: the text beside it says it. */
export function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 12.5;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <span aria-hidden className="relative inline-grid size-7 shrink-0 place-items-center">
      <svg width={28} height={28} className="-rotate-90">
        <circle cx={14} cy={14} r={r} fill="none" strokeWidth={3} stroke="var(--surface-sunken)" />
        <circle
          cx={14}
          cy={14}
          r={r}
          fill="none"
          strokeWidth={3}
          stroke={share >= 1 ? "var(--success-solid)" : "var(--chart-1)"}
          strokeDasharray={`${c * share} ${c}`}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-medium tabular-nums">
        {Math.round(share * 100)}
      </span>
    </span>
  );
}
