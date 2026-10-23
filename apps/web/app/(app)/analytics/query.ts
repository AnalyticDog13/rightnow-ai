import { line } from "@rightnow/core/csv";

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

/** CSV text for the tables the API has no CSV for; the same cell rules as the server exports. */
export const csvText = (rows: unknown[][]) => rows.map(line).join("");

/** Today's date in `tz`; a zone this browser does not know falls back to UTC, and the API then answers 400 invalid_tz. */
export function todayIn(tz: string): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
