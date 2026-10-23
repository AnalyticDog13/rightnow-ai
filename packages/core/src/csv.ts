// No imports: the browser bundle uses this through `@rightnow/core/csv` without pulling in Prisma.
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/** CSV injection: a cell a spreadsheet would read as a formula gets a `'` prefix. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // plain numbers stay numbers; anything else a spreadsheet could read as a formula (even behind spaces or quotes) is prefixed
  if (!NUMBER.test(s) && /^[\t\r]|^[\s"']*[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const line = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";
