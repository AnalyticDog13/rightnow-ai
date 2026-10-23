import { listLeads, type LeadQuery } from "./service";

const FIXED = [
  ...["email", "firstName", "lastName", "companyName", "companyDomain", "jobTitle", "website"],
  ...["industry", "phone", "personalization", "country", "source", "lawfulBasis", "tags", "labels"],
  ...["verificationStatus", "espType", "esg", "interestStatus", "createdAt"],
] as const;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/** CSV injection: a cell a spreadsheet would read as a formula gets a `'` prefix. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // plain numbers stay numbers; anything else a spreadsheet could read as a formula (even behind spaces or quotes) is prefixed
  if (!NUMBER.test(s) && /^[\t\r]|^[\s"']*[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const line = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";

async function* pages(prisma: Parameters<typeof listLeads>[0], ws: string, q: LeadQuery) {
  let cursor: string | undefined;
  do {
    const r = await listLeads(prisma, ws, { ...q, take: 100, cursor });
    yield r.leads;
    cursor = r.nextCursor ?? undefined;
  } while (cursor);
}

/** Streams the filtered leads page by page (two passes: custom columns are the union across all leads). */
export async function* exportLeadsCsv(
  prisma: Parameters<typeof listLeads>[0],
  ws: string,
  q: LeadQuery,
): AsyncIterable<string> {
  const keys = new Set<string>();
  for await (const leads of pages(prisma, ws, q))
    for (const l of leads)
      for (const k of Object.keys((l.customFields ?? {}) as object)) keys.add(k);
  const custom = [...keys].sort();
  yield line([...FIXED, ...custom]);
  for await (const leads of pages(prisma, ws, q)) {
    yield leads
      .map((l) => {
        const cf = (l.customFields ?? {}) as Record<string, unknown>;
        const row = FIXED.map((k) => {
          const v = l[k];
          return Array.isArray(v) ? v.join(";") : v;
        });
        return line([...row, ...custom.map((k) => cf[k])]);
      })
      .join("");
  }
}
