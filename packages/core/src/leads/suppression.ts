import { createHash } from "node:crypto";
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
  const r = await tx.suppression.createMany({
    data: entries.map((e) => {
      const value = e.value.trim().toLowerCase();
      return { workspaceId: ws, kind: e.kind, value, valueHash: hashValue(value), reason, source };
    }),
    skipDuplicates: true,
  });
  return r.count;
}

/** True when the address, or its domain, is on the workspace blocklist. */
export async function isSuppressed(tx: Tx, ws: string, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const domain = e.slice(e.lastIndexOf("@") + 1);
  return !!(await tx.suppression.findFirst({
    where: {
      workspaceId: ws,
      OR: [
        { kind: "EMAIL", valueHash: hashValue(e) },
        { kind: "DOMAIN", valueHash: hashValue(domain) },
      ],
    },
    select: { id: true },
  }));
}
