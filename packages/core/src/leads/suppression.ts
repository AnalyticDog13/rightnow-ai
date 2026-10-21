import { createHash } from "node:crypto";
import { editHooks } from "../campaigns/hooks";
import { OPEN_STATES_SQL } from "../campaigns/lead-status";
import type { Prisma, SuppressionKind, SuppressionReason } from "@rightnow/db/client";

type Tx = Prisma.TransactionClient;

export const hashValue = (v: string) => createHash("sha256").update(v.toLowerCase()).digest("hex");

/** Adds entries to the workspace blocklist; existing ones are kept as they are. Returns how many were new. */
export async function suppress(
  tx: Tx,
  ws: string,
  entries: { kind: SuppressionKind; value: string }[],
  reason: SuppressionReason,
  source: string,
): Promise<number> {
  const norm = entries.map((e) => ({ kind: e.kind, value: e.value.trim().toLowerCase() }));
  const r = await tx.suppression.createMany({
    data: norm.map((e) => ({
      workspaceId: ws,
      ...e,
      valueHash: hashValue(e.value),
      reason,
      source,
    })),
    skipDuplicates: true,
  });
  // PS-LEAD-23: every open CampaignLead of a matching address or domain stops (set-based, any campaign).
  const of = (k: SuppressionKind) => norm.filter((e) => e.kind === k).map((e) => e.value);
  const [emails, domains] = [of("EMAIL"), of("DOMAIN")];
  if (emails.length || domains.length) {
    const hit = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "CampaignLead" cl SET "state" = 'STOPPED', "stopReason" = 'SUPPRESSED', "nextDueAt" = NULL, "completedAt" = now()
      FROM "Lead" l
      WHERE l."id" = cl."leadId" AND cl."workspaceId" = ${ws}
        AND cl."state" = ANY(${OPEN_STATES_SQL})
        AND (l."email" = ANY(${emails}::text[]) OR substring(l."email" from '@([^@]*)$') = ANY(${domains}::text[]))
      RETURNING cl."id"`;
    if (hit.length)
      await editHooks.cancelOpenRows(
        tx,
        hit.map((h) => h.id),
      );
  }
  return r.count;
}

/** The lowercased addresses among `emails` that are blocked, by address or by domain (batch form for import, enrollment and send checks). */
export async function suppressedEmails(
  tx: Pick<Tx, "suppression">,
  ws: string,
  emails: string[],
): Promise<Set<string>> {
  const list = emails.map((e) => e.trim().toLowerCase());
  const domainOf = (e: string) => e.slice(e.lastIndexOf("@") + 1);
  const rows = await tx.suppression.findMany({
    where: {
      workspaceId: ws,
      OR: [
        { kind: "EMAIL", valueHash: { in: list.map(hashValue) } },
        {
          kind: "DOMAIN",
          valueHash: { in: [...new Set(list.map((e) => hashValue(domainOf(e))))] },
        },
      ],
    },
    select: { kind: true, valueHash: true },
  });
  const hit = new Set(rows.map((r) => `${r.kind}:${r.valueHash}`));
  return new Set(
    list.filter(
      (e) => hit.has(`EMAIL:${hashValue(e)}`) || hit.has(`DOMAIN:${hashValue(domainOf(e))}`),
    ),
  );
}

/** True when the address, or its domain, is on the workspace blocklist. */
export async function isSuppressed(tx: Pick<Tx, "suppression">, ws: string, email: string) {
  return (await suppressedEmails(tx, ws, [email])).size > 0;
}
