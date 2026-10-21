import type { Prisma } from "@rightnow/db/client";

type Tx = Prisma.TransactionClient;
export type EventInput = Omit<Prisma.EventUncheckedCreateInput, "id" | "createdAt">;

/** INSERT ... ON CONFLICT ("dedupeKey") DO NOTHING. True when inserted: counters move only then. */
export async function recordEvent(tx: Tx, e: EventInput): Promise<boolean> {
  const r = await tx.event.createMany({ data: e, skipDuplicates: true });
  return r.count === 1;
}
