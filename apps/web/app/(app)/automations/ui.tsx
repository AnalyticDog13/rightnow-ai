import { AlertCircle } from "lucide-react";

/** An action's error, announced; tests read it as `p[role=alert]`. */
export function Err({ text }: { text: string }) {
  return text ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger-solid/30 bg-danger-tint px-3.5 py-3 text-[13px]/[18px] text-fg"
    >
      <AlertCircle className="mt-px size-4 shrink-0 text-danger" aria-hidden />
      {text}
    </p>
  ) : null;
}

/** Column headers for a table inside TableFrame (which styles them). */
export function Head({ cols, right = [] }: { cols: string[]; right?: string[] }) {
  return (
    <thead>
      <tr>
        {cols.map((h) => (
          <th key={h} scope="col" className={right.includes(h) ? "text-right" : undefined}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}
