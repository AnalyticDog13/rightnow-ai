import { localMidnightUtc } from "@rightnow/core/schedule";

const DAY = 86_400_000;
const isDay = (s: string | undefined): s is string => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") &&
    !Number.isNaN(t) &&
    new Date(t).toISOString().startsWith(s!)
  );
};

/** URL filters -> the opportunities API query. Only known keys pass; from/to are local days of the workspace `tz`. */
export function boardQuery(
  sp: Record<string, string | undefined>,
  tz: string,
): Record<string, string> {
  const q: Record<string, string> = {};
  for (const k of ["campaignId", "listId", "ownerId", "stageId", "q"] as const)
    if (sp[k]) q[k] = sp[k]!;
  if (isDay(sp.from)) q.from = localMidnightUtc(sp.from, tz).toISOString();
  if (isDay(sp.to)) {
    const next = new Date(Date.parse(sp.to) + DAY).toISOString().slice(0, 10);
    q.to = new Date(localMidnightUtc(next, tz).getTime() - 1).toISOString(); // the API's `to` is inclusive
  }
  return q;
}
