const DAY = 86_400_000;
/** The filters the analytics API accepts; anything else in the page URL is dropped. */
export const FILTER_KEYS = [
  ...["campaignIds", "accountIds", "campaignTag", "ownerId", "status", "esp", "listId", "tag"],
  ...["from", "to", "tz", "replyBase", "includeAutoReplies"],
] as const;

/** The last `days` local days ending today (inclusive). */
export function preset(days: number, today: string) {
  const to = Date.parse(today);
  return {
    from: new Date(to - (days - 1) * DAY).toISOString().slice(0, 10),
    to: today,
  };
}

/** Page URL -> analytics API query: known keys only, the 30-day range and the zone filled in. */
export function apiParams(
  sp: URLSearchParams,
  d: { tz: string; today: string },
  groupBy?: string,
): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (sp.get(k)) p.set(k, sp.get(k)!);
  if (!p.has("tz")) p.set("tz", d.tz);
  if (!p.has("from") || !p.has("to")) {
    const r = preset(30, d.today);
    p.set("from", r.from);
    p.set("to", r.to);
  }
  if (groupBy) p.set("groupBy", groupBy);
  return p;
}

/** PS-18 tooltip copy: "{numerator} of {denominator} {base}". */
export const rateTip = (n: number, d: number, base: string) => `${n} of ${d} ${base}`;

/** CSV text for the tables the API has no CSV for; a cell a spreadsheet would run as a formula gets a `'`. */
export const csvText = (rows: unknown[][]) =>
  rows
    .map(
      (r) =>
        r
          .map((v) => {
            let s = v === null || v === undefined ? "" : String(v);
            if (typeof v !== "number" && /^[\t\r]|^[\s"']*[=+\-@]/.test(s)) s = `'${s}`;
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",") + "\r\n",
    )
    .join("");
