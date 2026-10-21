/* eslint-disable @typescript-eslint/no-unused-vars -- stubs until T09 fills the bodies */
import type { Prisma } from "@rightnow/db/client";

type Tx = Prisma.TransactionClient;

/**
 * Seams for the send tables. `ScheduledMessage` arrives in P3-T09, so the bodies below are no-ops until then.
 * T09 replaces them in place; every caller already runs them INSIDE the transaction that changes the sequence.
 *
 * Common rules (lock order, I4): take the ScheduledMessage rows first, `FOR UPDATE SKIP LOCKED`, before anything else.
 * Only status SCHEDULED rows are ever touched. SENDING and UNCERTAIN rows belong to the sender / resolveUncertain.
 *
 * STALE TEXT (Revision 3): a row skipped here because a claim holds it keeps its rendered text, which is fine only
 * if it is sent as rendered. Any path that puts a row BACK to SCHEDULED later (T11 RETRY / RELEASED / stale-claim
 * recovery) and the claim itself must therefore re-run `renderForLead` under the row lock and overwrite
 * renderedSubject / renderedBody / renderedText when the variant changed or went inactive (rendering is
 * deterministic per seed and has no network). If the variant is gone or inactive, the row is CANCELLED instead.
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
  /** Step order or delays changed: CANCEL the campaign's SCHEDULED rows of that sequence so dueAt is recomputed. */
  async stepsChanged(
    _tx: Tx,
    _p: { workspaceId: string; campaignId: string; subsequenceId: string | null },
  ): Promise<void> {},
  /**
   * CampaignLeads left the main flow (moved to a subsequence, removed, suppressed): CANCEL their SCHEDULED rows in the
   * same transaction (C2). T10b wraps this as enterSubsequence / skipStep.
   */
  async cancelOpenRows(_tx: Tx, _campaignLeadIds: string[]): Promise<void> {},
};
