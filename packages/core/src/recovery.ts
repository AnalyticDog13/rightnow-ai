import type { EmailAccount, Prisma, PrismaClient, ScheduledMessage } from "@rightnow/db/client";
import type { MailProvider, RemoteMessage } from "@rightnow/providers";
import type { Clock } from "./clock";
import { withTxRetry } from "./dispatch";
import { releaseUsage } from "./quota";
import { recordAccepted, refOf, type SenderDeps } from "./sender";

export const RESEARCH_MS = 15 * 60_000;
export const UNCERTAIN_CAP_MS = 24 * 3600_000;
const BATCH = 50;
const TX = { timeout: 10_000 };

/**
 * A SENDING row whose claim is older than the lease may have gone out: it becomes UNCERTAIN (searched in Sent, never
 * resent), never SCHEDULED. One statement, so it applies only to rows still SENDING at that moment.
 */
export async function recoverExpired(
  db: PrismaClient,
  clock: Clock,
  leaseSec = 600,
): Promise<number> {
  const now = clock.now();
  return db.$executeRaw`UPDATE "ScheduledMessage"
    SET status = 'UNCERTAIN', "uncertainAt" = ${now}, error = 'lease_expired', "updatedAt" = ${now}
    WHERE status = 'SENDING' AND "claimedAt" < ${new Date(now.getTime() - leaseSec * 1000)}`;
}

/** UNCERTAIN → HELD with its reservation released, conditional on the row still being as read (D5). */
async function hold(
  db: PrismaClient,
  m: ScheduledMessage,
  now: Date,
  as: Prisma.ScheduledMessageWhereInput,
) {
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const r = await tx.scheduledMessage.updateMany({
        where: { id: m.id, status: "UNCERTAIN", ...as },
        data: { status: "HELD", lastSearchAt: now },
      });
      if (r.count) await releaseUsage(tx, refOf(m));
      return r.count > 0;
    }, TX),
  );
}

/**
 * D5 / I2. Never sends. Up to 50 rows due for a search (never searched, or last attempt ≥ 15 min ago): found → SENT
 * through the sender's late-accept path (`recordAccepted`, which advances only an open lead); not found once →
 * re-search after 15 min; not found twice → HELD. 24 h cap: a search that fails (throws) on a row older than 24 h whose
 * previous attempt was ≥ 15 min earlier → HELD, so nothing is held by the clock alone or by one failed search on wake
 * (Revision 3, D24). Every provider call runs outside any transaction; one failing row never blocks the others (I5).
 */
export async function resolveUncertain(
  db: PrismaClient,
  clock: Clock,
  deps: Pick<SenderDeps, "providerFor"> & { signal?: AbortSignal },
): Promise<{ sent: number; held: number; searched: number; errors: number }> {
  const out = { sent: 0, held: 0, searched: 0, errors: 0 };
  const now = clock.now();
  const due = await db.scheduledMessage.findMany({
    where: {
      status: "UNCERTAIN",
      OR: [
        { lastSearchAt: null },
        { lastSearchAt: { lte: new Date(now.getTime() - RESEARCH_MS) } },
      ],
    },
    include: { account: true },
    orderBy: [{ uncertainAt: "asc" }, { id: "asc" }],
    take: BATCH,
  });
  for (const m of due) {
    if (deps.signal?.aborted) break; // worker stopping: the rest wait for the next run
    try {
      const r = await resolveOne(db, clock, deps, m, now);
      if (r !== "error" && r !== "capped") out.searched += 1;
      if (r === "sent") out.sent += 1;
      if (r === "held") out.held += 1;
      if (r === "error" || r === "capped") out.errors += 1;
      if (r === "capped") out.held += 1;
    } catch (e) {
      out.errors += 1;
      console.error(`resolveUncertain: row ${m.id}`, e);
    }
  }
  return out;
}

async function resolveOne(
  db: PrismaClient,
  clock: Clock,
  deps: Pick<SenderDeps, "providerFor">,
  m: ScheduledMessage & { account: EmailAccount },
  now: Date,
): Promise<"sent" | "held" | "capped" | "waiting" | "error"> {
  let provider: MailProvider;
  let found: RemoteMessage | null;
  try {
    provider = deps.providerFor(m.account);
    found = m.rfcMessageId
      ? await provider.findSent(
          m.rfcMessageId,
          m.providerMessageId ? { providerMessageId: m.providerMessageId } : undefined,
        )
      : null;
  } catch {
    // a failed attempt is not a "not found"; the second one ≥ 15 min apart past 24 h holds (cap)
    const old = m.uncertainAt && m.uncertainAt.getTime() <= now.getTime() - UNCERTAIN_CAP_MS;
    if (old && m.lastSearchAt)
      return (await hold(db, m, now, { lastSearchAt: m.lastSearchAt })) ? "capped" : "error";
    await db.scheduledMessage.updateMany({
      where: { id: m.id, status: "UNCERTAIN" },
      data: { lastSearchAt: now },
    });
    return "error";
  }
  if (found) {
    const d = found.date;
    const res = await recordAccepted(
      db,
      clock,
      {
        ...refOf(m),
        id: m.id,
        campaignLeadId: m.campaignLeadId,
        stepId: m.stepId,
        claimToken: m.claimToken ?? "",
        claimedAt: m.claimedAt ?? now,
        rfcMessageId: m.rfcMessageId!,
      },
      {
        rfcMessageId: m.rfcMessageId!,
        providerMessageId: found.providerMessageId,
        providerThreadId: found.providerThreadId,
      },
      d.getTime() > 0 && d <= now ? d : now, // a missing (epoch) or future Date header falls back to now
    );
    return res === "SENT" ? "sent" : "waiting";
  }
  if (m.searchCount === 0) {
    await db.scheduledMessage.updateMany({
      where: { id: m.id, status: "UNCERTAIN", searchCount: 0 },
      data: { searchCount: 1, lastSearchAt: now },
    });
    return "waiting";
  }
  if (!(await hold(db, m, now, { searchCount: { gte: 1 } }))) return "waiting";
  const draft = provider as MailProvider & { deleteDraft?: (id: string) => Promise<void> };
  if (m.account.provider === "MICROSOFT" && m.providerMessageId && draft.deleteDraft)
    await draft.deleteDraft(m.providerMessageId).catch(() => {}); // best effort; it deletes only a draft
  return "held";
}
