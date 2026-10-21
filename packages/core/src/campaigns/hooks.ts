/* eslint-disable @typescript-eslint/no-unused-vars -- stubs until T09 fills the bodies */
import type { Prisma } from "@rightnow/db/client";

type Tx = Prisma.TransactionClient;

/**
 * Seams for the send tables. `ScheduledMessage` arrives in P3-T09, so the bodies below are no-ops until then.
 * T09 replaces them in place; every caller already runs them INSIDE the transaction that changes the sequence.
 *
 * Rules for the hook bodies: only status SCHEDULED rows are touched (SELECT ... FOR UPDATE SKIP LOCKED never waits, so
 * there is no lock-order constraint here). SENDING and UNCERTAIN rows belong to the sender / resolveUncertain.
 * A row skipped because a claim holds it is NOT cancelled by these hooks, so the CLAIM must protect itself:
 *
 * CLAIM-SIDE RE-CHECKS (T09, binding). Inside the claim transaction, after locking the ScheduledMessage row and then
 * the CampaignLead row (I4 order), verify ALL of the following, else CANCEL the row (uncertainAt NULL) and move on:
 *   - cl.state = 'ACTIVE' (QUEUED only for a step-1 row of the main sequence; PAUSED, STOPPED, COMPLETED reject);
 *   - sm.stepId = cl.currentStepId (a lead moved to a subsequence, or advanced, rejects every old-flow row);
 *   - Lead.deletedAt IS NULL (merged and deleted leads are never mailed);
 *   - the step is live (SequenceStep.deletedAt IS NULL);
 *   - the variant exists and is active.
 * A subsequence move leaves the lead with a new currentStepId and subsequenceId, so the second check rejects the
 * old rows even when the hook skipped them. Entering a subsequence on a QUEUED lead leaves accountId null: the first
 * subsequence step needs a routing rule (T10b). Re-entering a subsequence hits the (campaignLeadId, stepId)
 * idempotency key (T10b must decide: reject or reuse). dueAt is recomputed from the previous step's sentAt, so a
 * shortened delay makes a row immediately due (the window and gap rules still apply).
 *
 * STALE TEXT (Revision 3): a claimed row keeps its rendered text and is sent as rendered. Any path that puts a row
 * BACK to SCHEDULED later (T11 RETRY / RELEASED / stale-claim recovery) and the claim itself must re-run
 * `renderForLead` under the row lock and overwrite renderedSubject / renderedBody / renderedText when the variant
 * text changed (deterministic per seed, no network). If the variant is gone or inactive, the row is CANCELLED.
 *
 * suppress() stamps SUPPRESSED on the CampaignLeads it stops. Callers that know better (T08 unsubscribe: UNSUBSCRIBED,
 * T11 bounce: BOUNCED) must set their own stopReason first or in the same transaction before calling suppress().
 */
export const editHooks = {
  /**
   * A variant's subject, body, weight or `active` changed, or the variant was deleted (`removed`).
   * T09: SCHEDULED rows of the variant are CANCELLED (uncertainAt NULL) so the planner re-plans them with the new text.
   */
  async variantChanged(
    _tx: Tx,
    _p: {
      workspaceId: string;
      campaignId: string;
      stepId: string;
      variantId: string;
      removed: boolean;
    },
  ): Promise<void> {},
  /** True when a ScheduledMessage references the step; deleteStep then soft-deletes it (M5, stepId is Restrict). */
  async stepReferenced(_tx: Tx, _stepId: string): Promise<boolean> {
    return false;
  },
  /** A step was deleted: CANCEL its SCHEDULED rows. T10b moves the leads whose currentStepId is the step (skipStep). */
  async stepRemoved(
    _tx: Tx,
    _p: { workspaceId: string; campaignId: string; stepId: string },
  ): Promise<void> {},
  /**
   * Step order or delay really changed (never called for a no-op patch). CANCEL the SCHEDULED rows of `stepId` (or of
   * the whole sequence when `stepId` is absent: reorder, delete) so dueAt is recomputed.
   */
  async stepsChanged(
    _tx: Tx,
    _p: { workspaceId: string; campaignId: string; subsequenceId: string | null; stepId?: string },
  ): Promise<void> {},
  /** True once any non-cancelled ScheduledMessage of the campaign exists; reorderSteps is then refused (409). */
  async campaignHasSends(_tx: Tx, _campaignId: string): Promise<boolean> {
    return false;
  },
  /**
   * CampaignLeads left the main flow (moved to a subsequence, removed, suppressed): CANCEL their SCHEDULED rows in the
   * same transaction (C2). T10b wraps this as enterSubsequence / skipStep.
   */
  async cancelOpenRows(_tx: Tx, _campaignLeadIds: string[]): Promise<void> {},
};

const OPEN = ["QUEUED", "ACTIVE", "PAUSED"] as const;

/** STOPs the open CampaignLeads of these leads (lead deleted or merged away) and cancels their open rows, in `tx`. */
export async function stopOpenCampaignLeads(
  tx: Tx,
  ws: string,
  leadIds: string[],
  stopReason: "SKIPPED" | "MANUAL" = "SKIPPED",
  at = new Date(),
) {
  if (!leadIds.length) return;
  const ids = (
    await tx.campaignLead.findMany({
      where: { workspaceId: ws, leadId: { in: leadIds }, state: { in: [...OPEN] } },
      select: { id: true },
    })
  ).map((c) => c.id);
  if (!ids.length) return;
  await tx.campaignLead.updateMany({
    where: { id: { in: ids }, state: { in: [...OPEN] } },
    data: { state: "STOPPED", stopReason, nextDueAt: null, completedAt: at },
  });
  await editHooks.cancelOpenRows(tx, ids);
}
