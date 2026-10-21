import { Prisma, type PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { audit } from "./audit";
import { CampaignError } from "./campaigns/service";
import type { Clock } from "./clock";
import { withTxRetry } from "./dispatch";
import { skipStep } from "./planner";

type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;
const TX = { timeout: 10_000 };

/**
 * Locks the workspace's row, then its CampaignLead (D21 order). 404 when the row is not in `ws`. Every write that
 * follows is conditional on what these locks read.
 */
async function lockBoth(tx: Tx, ws: string, id: string) {
  const [m] = await tx.$queryRaw<{ status: string; campaignLeadId: string; stepId: string }[]>`
    SELECT status::text, "campaignLeadId", "stepId" FROM "ScheduledMessage"
    WHERE id = ${id} AND "workspaceId" = ${ws} FOR UPDATE`;
  if (!m) throw new CampaignError(404, "Not found");
  const [cl] = await tx.$queryRaw<{ state: string; currentStepId: string | null }[]>`
    SELECT state::text, "currentStepId" FROM "CampaignLead" WHERE id = ${m.campaignLeadId} FOR NO KEY UPDATE`;
  return { m, cl: cl! };
}

const inTx = <T>(db: PrismaClient, f: (tx: Tx) => Promise<T>) =>
  withTxRetry(() => db.$transaction(f, TX));

/**
 * A human decision on a HELD row (D5): back to SCHEDULED, due now, with the same Message-ID (a late copy then settles
 * as a late accept). It may send a duplicate, so `confirm` is required (400). 409 unless the row is HELD, its step is the
 * lead's current step (C2) and the lead is ACTIVE (M15). uncertainAt is cleared (D25): the duplicate risk is accepted
 * here, so a later plain cancel (dead variant, edit, pause) lets the planner re-plan the step instead of stranding it.
 */
export async function releaseHeld(
  db: PrismaClient,
  clock: Clock,
  ws: string,
  id: string,
  actorId: Actor,
  o: { confirm?: boolean },
) {
  if (o.confirm !== true) throw new CampaignError(400, "confirm_required: may send a duplicate");
  await inTx(db, async (tx) => {
    const { m, cl } = await lockBoth(tx, ws, id);
    if (m.status !== "HELD") throw new CampaignError(409, "not_held");
    if (cl.currentStepId !== m.stepId) throw new CampaignError(409, "step_not_current");
    if (cl.state !== "ACTIVE") throw new CampaignError(409, "lead_not_active");
    await tx.scheduledMessage.update({
      where: { id },
      data: {
        status: "SCHEDULED",
        dueAt: clock.now(),
        error: null,
        uncertainAt: null,
        searchCount: 0,
        lastSearchAt: null,
      },
    });
    await audit(tx, { workspaceId: ws, actorId }, "message.release", id);
  });
}

/**
 * C1: SCHEDULED or HELD → CANCELLED, and the lead moves past the step (skipStep) in the same transaction, so the step is
 * never re-planned. A HELD row keeps uncertainAt, which the planner never revives.
 */
export async function cancelScheduled(
  db: PrismaClient,
  clock: Clock,
  ws: string,
  id: string,
  actorId: Actor,
) {
  await inTx(db, async (tx) => {
    const { m } = await lockBoth(tx, ws, id);
    if (m.status !== "SCHEDULED" && m.status !== "HELD")
      throw new CampaignError(409, "not_cancellable");
    await tx.scheduledMessage.update({ where: { id }, data: { status: "CANCELLED" } });
    await skipStep(tx, clock, m.campaignLeadId, m.stepId);
    await audit(tx, { workspaceId: ws, actorId }, "message.cancel", id, { from: m.status });
  });
}

/** FAILED → SCHEDULED (attempts 0), and a lead paused by the failure (SEND_FAILED) is ACTIVE again. 409 unless current. */
export async function retryFailed(
  db: PrismaClient,
  clock: Clock,
  ws: string,
  id: string,
  actorId: Actor,
) {
  await inTx(db, async (tx) => {
    const { m, cl } = await lockBoth(tx, ws, id);
    if (m.status !== "FAILED") throw new CampaignError(409, "not_failed");
    if (cl.currentStepId !== m.stepId) throw new CampaignError(409, "step_not_current");
    if (cl.state === "STOPPED" || cl.state === "COMPLETED")
      throw new CampaignError(409, "lead_not_active");
    await tx.scheduledMessage.update({
      where: { id },
      data: { status: "SCHEDULED", dueAt: clock.now(), attempts: 0, claimErrors: 0, error: null },
    });
    await tx.campaignLead.updateMany({
      where: { id: m.campaignLeadId, state: "PAUSED", stopReason: "SEND_FAILED" },
      data: { state: "ACTIVE", stopReason: null },
    });
    await audit(tx, { workspaceId: ws, actorId }, "message.retry", id);
  });
}

export const scheduledQuery = z.strictObject({
  status: z
    .enum(["SCHEDULED", "SENDING", "SENT", "FAILED", "CANCELLED", "UNCERTAIN", "HELD"])
    .optional(),
  campaignId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

/** The send queue and dead-letter view (PS-SEND-17): oldest due first, cursor-paged. */
export async function listScheduled(
  db: PrismaClient,
  ws: string,
  q: z.infer<typeof scheduledQuery>,
) {
  const take = q.take ?? 50;
  const found = await db.scheduledMessage.findMany({
    where: {
      workspaceId: ws,
      ...(q.status && { status: q.status }),
      ...(q.campaignId && { campaignId: q.campaignId }),
      ...(q.accountId && { accountId: q.accountId }),
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(q.cursor && { cursor: { id: q.cursor } }),
    select: {
      id: true,
      campaignId: true,
      campaignLeadId: true,
      stepId: true,
      accountId: true,
      status: true,
      dueAt: true,
      sentAt: true,
      error: true,
      renderedSubject: true,
      uncertainAt: true,
      searchCount: true,
      lastSearchAt: true,
      account: { select: { email: true } },
      campaignLead: { select: { lead: { select: { email: true } } } },
    },
  });
  const next = found.length > take ? found.pop()! : null;
  return {
    rows: found.map(({ account, campaignLead, ...r }) => ({
      ...r,
      accountEmail: account.email,
      leadEmail: campaignLead.lead.email,
    })),
    nextCursor: next?.id ?? null,
  };
}
