const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** URL filters -> the opportunities API query. Only known keys pass; the day bounds are UTC. */
export function boardQuery(sp: Record<string, string | undefined>): Record<string, string> {
  const q: Record<string, string> = {};
  for (const k of ["campaignId", "listId", "ownerId", "stageId", "q"] as const)
    if (sp[k]) q[k] = sp[k]!;
  if (sp.from && DAY.test(sp.from)) q.from = `${sp.from}T00:00:00.000Z`;
  if (sp.to && DAY.test(sp.to)) q.to = `${sp.to}T23:59:59.999Z`;
  return q;
}
