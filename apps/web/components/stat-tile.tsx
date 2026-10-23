import { Card } from "./ui/card";

/** A figure with its label; `title` is the tooltip (denominator or caveat), `note` the visible hint under it. */
export function StatTile({
  label,
  value,
  title,
  note,
}: {
  label: string;
  value: string;
  title?: string;
  note?: string;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4" role="group" aria-label={label} title={title}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}

export const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);
