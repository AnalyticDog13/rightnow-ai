export const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

export function Err({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null;
}

export function Head({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-border">
        {cols.map((h) => (
          <th key={h} className="p-3 font-medium">
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}
