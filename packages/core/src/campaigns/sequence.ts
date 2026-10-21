import type { DelayUnit, Prisma, PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { audit } from "../audit";
import { systemClock } from "../clock";
import { withTxRetry } from "../dispatch";
import { recomputeDue, skipStep } from "../planner";
import { TEMPLATE_VARIABLES, validateTemplate } from "../template";
import { editHooks } from "./hooks";
import { CampaignError, liveCampaign } from "./service";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;

export const MAX_VARIANTS = 26;
export const MAX_SEQUENCE_DAYS = 366;
const MINUTES: Record<DelayUnit, number> = { MINUTES: 1, HOURS: 60, DAYS: 1440 };
const MAX_MINUTES = MAX_SEQUENCE_DAYS * 1440;
const INTEREST = [1, 2, 3, 4, 0, -1, -2, -3, -4];
const phrase = z.string().trim().min(1).max(200);
const LABELS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

export const stepInput = z.strictObject({
  subsequenceId: z.string().min(1).nullish(),
  delayValue: z.number().int().min(0).max(MAX_MINUTES),
  delayUnit: z.enum(["MINUTES", "HOURS", "DAYS"]).default("DAYS"),
});
export const stepPatch = z
  .strictObject({
    delayValue: z.number().int().min(0).max(MAX_MINUTES),
    delayUnit: z.enum(["MINUTES", "HOURS", "DAYS"]),
  })
  .partial();

export const variantInput = z.strictObject({
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(100_000),
  weight: z.number().int().min(1).max(1000).default(1),
});
export const variantPatch = z
  .strictObject({
    subject: variantInput.shape.subject,
    body: variantInput.shape.body,
    weight: variantInput.shape.weight,
    active: z.boolean(),
  })
  .partial();

export const triggerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("LEAD_STATUS"),
    interest: z
      .array(z.number().refine((v) => INTEREST.includes(v)))
      .min(1)
      .max(9),
  }),
  z.strictObject({
    kind: z.literal("ACTIVITY"),
    activity: z.enum(["completed_no_reply", "opened", "clicked"]),
  }),
  z.strictObject({ kind: z.literal("REPLY_KEYWORD"), phrases: z.array(phrase).min(1).max(50) }),
]);
export const subsequenceInput = z.strictObject({
  name: phrase,
  trigger: triggerSchema,
  preDelayMinutes: z.number().int().min(0).max(MAX_MINUTES).default(0),
  dailyLimit: z.number().int().min(1).nullish(),
});

/** Cumulative delay of a sequence must stay within a year (PS-SEQ-02). */
export function assertTotalDelay(steps: { delayValue: number; delayUnit: DelayUnit }[]) {
  const total = steps.reduce((n, s) => n + s.delayValue * MINUTES[s.delayUnit], 0);
  if (total > MAX_MINUTES) throw new CampaignError(400, "sequence_too_long");
}

/** The campaign row, locked: serializes edits of its steps and variants. */
async function lock(tx: Tx, ws: string, id: string) {
  const c = await liveCampaign(tx, ws, id);
  await tx.$queryRaw`SELECT 1 FROM "Campaign" WHERE "id" = ${id} FOR UPDATE`;
  return c;
}
const done = (
  tx: Tx,
  ws: string,
  actorId: Actor,
  id: string,
  meta: Record<string, string | number | boolean | null | string[]>,
) => audit(tx, { workspaceId: ws, actorId }, "campaign.update", id, meta);

const liveSteps = (tx: Tx, campaignId: string, subsequenceId: string | null) =>
  tx.sequenceStep.findMany({
    where: { campaignId, subsequenceId, deletedAt: null },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });

/** Renumbers 1..n, forces main step 1 to delay 0, checks the total. */
async function settle(
  tx: Tx,
  ws: string,
  campaignId: string,
  sub: string | null,
  changed: boolean,
) {
  const steps = await liveSteps(tx, campaignId, sub);
  for (const [i, s] of steps.entries()) {
    const first0 = !sub && i === 0 && s.delayValue !== 0;
    if (s.order !== i + 1 || first0) {
      await tx.sequenceStep.update({
        where: { id: s.id },
        data: { order: i + 1, ...(first0 && { delayValue: 0 }) },
      });
      if (first0) s.delayValue = 0;
    }
  }
  assertTotalDelay(steps);
  if (changed)
    await editHooks.stepsChanged(tx, { workspaceId: ws, campaignId, subsequenceId: sub });
}

async function liveSub(tx: Tx, campaignId: string, id: string) {
  const s = await tx.subsequence.findFirst({ where: { id, campaignId } });
  if (!s) throw new CampaignError(404, "Not found");
  return s;
}
async function stepOf(tx: Tx, ws: string, id: string) {
  const s = await tx.sequenceStep.findFirst({
    where: { id, deletedAt: null, campaign: { workspaceId: ws, deletedAt: null } },
  });
  if (!s) throw new CampaignError(404, "Not found");
  return s;
}

export async function addStep(
  prisma: Db,
  ws: string,
  actorId: Actor,
  campaignId: string,
  input: unknown,
) {
  const d = stepInput.parse(input);
  const sub = d.subsequenceId ?? null;
  return prisma.$transaction(async (tx) => {
    await lock(tx, ws, campaignId);
    if (sub) await liveSub(tx, campaignId, sub);
    const max = await tx.sequenceStep.aggregate({
      _max: { order: true },
      where: { campaignId, subsequenceId: sub },
    });
    const step = await tx.sequenceStep.create({
      data: {
        campaignId,
        subsequenceId: sub,
        order: (max._max.order ?? 0) + 1,
        delayValue: d.delayValue,
        delayUnit: d.delayUnit,
      },
    });
    await settle(tx, ws, campaignId, sub, false);
    await done(tx, ws, actorId, campaignId, { step: step.id });
    return tx.sequenceStep.findUniqueOrThrow({ where: { id: step.id } });
  });
}

export async function updateStep(
  prisma: Db,
  ws: string,
  actorId: Actor,
  stepId: string,
  patch: unknown,
) {
  const d = stepPatch.parse(patch);
  return prisma.$transaction(async (tx) => {
    const s = await stepOf(tx, ws, stepId);
    await lock(tx, ws, s.campaignId);
    await tx.sequenceStep.update({ where: { id: stepId }, data: d });
    await settle(tx, ws, s.campaignId, s.subsequenceId, false);
    const now = await tx.sequenceStep.findUniqueOrThrow({ where: { id: stepId } });
    // only a real change (after step 1 is forced to 0) re-plans rows, and only this step's
    if (now.delayValue !== s.delayValue || now.delayUnit !== s.delayUnit) {
      await editHooks.stepsChanged(tx, {
        workspaceId: ws,
        campaignId: s.campaignId,
        subsequenceId: s.subsequenceId,
        stepId,
      });
      await recomputeDue(tx, stepId); // after the rows (D21: ScheduledMessage before CampaignLead)
    }
    await done(tx, ws, actorId, s.campaignId, { step: stepId });
    return now;
  });
}

/**
 * A DRAFT campaign hard-deletes unless something points at the step. Any other campaign soft-deletes always: the
 * sender, advanceLead and the planner move currentStepId without taking the campaign lock, so a hard delete could
 * leave a dangling pointer.
 */
export async function deleteStep(prisma: Db, ws: string, actorId: Actor, stepId: string) {
  // shortcut: one transaction moves every lead on the step (30 s budget); batch it if steps hold 10k+ waiting leads
  await withTxRetry(() =>
    prisma.$transaction(async (tx) => deleteStepTx(tx, ws, actorId, stepId), { timeout: 30_000 }),
  );
}

async function deleteStepTx(tx: Tx, ws: string, actorId: Actor, stepId: string) {
  const s = await stepOf(tx, ws, stepId);
  await lock(tx, ws, s.campaignId);
  const c = await liveCampaign(tx, ws, s.campaignId);
  // a row whose outcome is open or unknown must be resolved first, or its lead could be moved under it
  if (
    await tx.scheduledMessage.count({
      where: { stepId, status: { in: ["SENDING", "UNCERTAIN", "HELD"] } },
    })
  )
    throw new CampaignError(409, "step_has_messages_in_flight");
  const waiting = await tx.campaignLead.findMany({
    where: { currentStepId: stepId, state: { in: ["QUEUED", "ACTIVE", "PAUSED"] } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const soft =
    c.status !== "DRAFT" ||
    (await tx.campaignLead.count({ where: { currentStepId: stepId } })) > 0 ||
    (await editHooks.stepReferenced(tx, stepId));
  await editHooks.stepRemoved(tx, { workspaceId: ws, campaignId: s.campaignId, stepId });
  // C1: leads on the step move past it, keeping their due time (main step 1: the next step becomes step 1)
  for (const cl of waiting) await skipStep(tx, systemClock, cl.id, stepId, { keepDue: true });
  if (soft)
    await tx.sequenceStep.update({ where: { id: stepId }, data: { deletedAt: new Date() } });
  else await tx.sequenceStep.delete({ where: { id: stepId } });
  await settle(tx, ws, s.campaignId, s.subsequenceId, true);
  await done(tx, ws, actorId, s.campaignId, { deletedStep: stepId });
}

export async function reorderSteps(
  prisma: Db,
  ws: string,
  actorId: Actor,
  campaignId: string,
  subsequenceId: string | null,
  ids: string[],
) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, ws, campaignId);
    const live = await liveSteps(tx, campaignId, subsequenceId);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== live.length ||
      !live.every((s) => ids.includes(s.id))
    )
      throw new CampaignError(400, "bad_order");
    if (live.every((s, i) => s.id === ids[i])) return live; // nothing moves, nothing to re-plan
    // A lead that already got step A would point back at it after a swap; duplicate the campaign instead.
    const c = await liveCampaign(tx, ws, campaignId);
    if (c.status !== "DRAFT" && (await editHooks.campaignHasSends(tx, campaignId)))
      throw new CampaignError(409, "campaign_has_sends");
    for (const [i, id] of ids.entries())
      await tx.sequenceStep.update({ where: { id }, data: { order: i + 1 } });
    await settle(tx, ws, campaignId, subsequenceId, true);
    await done(tx, ws, actorId, campaignId, { reordered: ids.length });
    return liveSteps(tx, campaignId, subsequenceId);
  });
}

/** Template variables a campaign may use: the lead fields plus the custom-field keys of its enrolled leads. */
export async function campaignVariables(db: Db | Tx, campaignId: string): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ k: string }[]>`
    SELECT DISTINCT jsonb_object_keys(l."customFields") AS k
    FROM "CampaignLead" cl JOIN "Lead" l ON l."id" = cl."leadId" WHERE cl."campaignId" = ${campaignId}`;
  return new Set([...TEMPLATE_VARIABLES, ...rows.map((r) => r.k)]);
}

export const templateIssues = (known: ReadonlySet<string>, subject: string, body: string) => [
  ...validateTemplate(subject, known).map((i) => ({ field: "subject", ...i })),
  ...validateTemplate(body, known).map((i) => ({ field: "body", ...i })),
];

async function variantOf(tx: Tx, ws: string, id: string) {
  const v = await tx.stepVariant.findFirst({
    where: { id, step: { deletedAt: null, campaign: { workspaceId: ws, deletedAt: null } } },
    include: { step: true },
  });
  if (!v) throw new CampaignError(404, "Not found");
  return v;
}
/** Leaving a step without an active variant would stall every lead on it. */
async function assertNotLastActive(tx: Tx, v: { id: string; stepId: string; active: boolean }) {
  if (
    v.active &&
    !(await tx.stepVariant.count({ where: { stepId: v.stepId, active: true, id: { not: v.id } } }))
  )
    throw new CampaignError(400, "last_active_variant");
}
async function assertTemplates(tx: Tx, campaignId: string, subject: string, body: string) {
  const issues = templateIssues(await campaignVariables(tx, campaignId), subject, body);
  if (issues.length) throw new CampaignError(400, "template_invalid", { issues });
}

export async function addVariant(
  prisma: Db,
  ws: string,
  actorId: Actor,
  stepId: string,
  input: unknown,
) {
  const d = variantInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const s = await stepOf(tx, ws, stepId);
    await lock(tx, ws, s.campaignId);
    await assertTemplates(tx, s.campaignId, d.subject, d.body);
    const used = new Set(
      (await tx.stepVariant.findMany({ where: { stepId }, select: { label: true } })).map(
        (v) => v.label,
      ),
    );
    const label = LABELS.find((l) => !used.has(l));
    if (!label) throw new CampaignError(400, "variant_limit");
    const v = await tx.stepVariant.create({ data: { ...d, stepId, label } });
    await done(tx, ws, actorId, s.campaignId, { variant: v.id });
    return v;
  });
}

export async function updateVariant(
  prisma: Db,
  ws: string,
  actorId: Actor,
  variantId: string,
  patch: unknown,
) {
  const d = variantPatch.parse(patch);
  return prisma.$transaction(async (tx) => {
    const was = await variantOf(tx, ws, variantId);
    const cid = was.step.campaignId;
    await lock(tx, ws, cid);
    if (d.active === false) await assertNotLastActive(tx, was);
    if (d.subject !== undefined || d.body !== undefined)
      await assertTemplates(tx, cid, d.subject ?? was.subject, d.body ?? was.body);
    const v = await tx.stepVariant.update({ where: { id: variantId }, data: d });
    // weight alone does not change any rendered text
    if (v.subject !== was.subject || v.body !== was.body || v.active !== was.active)
      await editHooks.variantChanged(tx, {
        workspaceId: ws,
        campaignId: cid,
        stepId: was.stepId,
        variantId,
        removed: false,
      });
    await done(tx, ws, actorId, cid, { variant: variantId });
    return v;
  });
}

export async function deleteVariant(prisma: Db, ws: string, actorId: Actor, variantId: string) {
  await prisma.$transaction(async (tx) => {
    const v = await variantOf(tx, ws, variantId);
    await lock(tx, ws, v.step.campaignId);
    await assertNotLastActive(tx, v);
    await editHooks.variantChanged(tx, {
      workspaceId: ws,
      campaignId: v.step.campaignId,
      stepId: v.stepId,
      variantId,
      removed: true,
    });
    await tx.stepVariant.delete({ where: { id: variantId } });
    await done(tx, ws, actorId, v.step.campaignId, { deletedVariant: variantId });
  });
}

export async function createSubsequence(
  prisma: Db,
  ws: string,
  actorId: Actor,
  campaignId: string,
  input: unknown,
) {
  const d = subsequenceInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const c = await lock(tx, ws, campaignId);
    // PS-SEQ-10: a subsequence inherits the campaign limit and may only lower it.
    if (d.dailyLimit && c.dailyLimit && d.dailyLimit > c.dailyLimit)
      throw new CampaignError(400, "daily_limit_above_campaign");
    const s = await tx.subsequence.create({
      data: { ...d, dailyLimit: d.dailyLimit ?? null, campaignId, activatedAt: new Date() },
    });
    await done(tx, ws, actorId, campaignId, { subsequence: s.id });
    return s;
  });
}

/** Activation stamps `activatedAt`; the planner (T10b) only moves leads whose trigger fired after it. */
export async function setSubsequenceActive(
  prisma: Db,
  ws: string,
  actorId: Actor,
  id: string,
  active: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const s = await tx.subsequence.findFirst({
      where: { id, campaign: { workspaceId: ws, deletedAt: null } },
    });
    if (!s) throw new CampaignError(404, "Not found");
    const r = await tx.subsequence.update({
      where: { id },
      data: { active, ...(active && !s.active && { activatedAt: new Date() }) },
    });
    await done(tx, ws, actorId, s.campaignId, { subsequence: id, active });
    return r;
  });
}

/** The whole sequence tree: live steps with variants, and subsequences with their steps. */
export async function getSequence(db: Db | Tx, ws: string, campaignId: string) {
  await liveCampaign(db, ws, campaignId);
  const include = { variants: { orderBy: { label: "asc" as const } } };
  const orderBy = [{ order: "asc" as const }, { id: "asc" as const }];
  const [steps, subsequences] = await Promise.all([
    db.sequenceStep.findMany({
      where: { campaignId, subsequenceId: null, deletedAt: null },
      orderBy,
      include,
    }),
    db.subsequence.findMany({
      where: { campaignId },
      orderBy: { createdAt: "asc" },
      include: { steps: { where: { deletedAt: null }, orderBy, include } },
    }),
  ]);
  return { steps, subsequences };
}

/** Launch/resume content checks (PS-CAMP-08): every problem at once. */
export async function campaignContentIssues(db: Db, campaignId: string, ws: string) {
  const issue = (code: string, message: string, extra: object = {}) => ({
    code,
    level: "block" as const,
    message,
    ...extra,
  });
  const out: ReturnType<typeof issue>[] = [];
  const { steps, subsequences } = await getSequence(db, ws, campaignId);
  if (!(await db.campaignLead.count({ where: { campaignId, workspaceId: ws } })))
    out.push(issue("no_leads", "Add leads"));
  if (!steps.some((s) => s.variants.some((v) => v.active)))
    out.push(issue("no_steps", "Add a first step with at least one active variant"));
  for (const s of steps)
    if (!s.variants.some((v) => v.active))
      out.push(issue("step_without_variant", "A step has no active variant", { stepId: s.id }));
  const known = await campaignVariables(db, campaignId);
  const all = [...steps, ...subsequences.filter((s) => s.active).flatMap((s) => s.steps)];
  for (const s of all)
    for (const v of s.variants.filter((v) => v.active)) {
      const issues = templateIssues(known, v.subject, v.body);
      if (issues.length)
        out.push(
          issue("template_error", `Variant ${v.label} has template errors`, {
            stepId: s.id,
            variantId: v.id,
            issues,
          }),
        );
    }
  return out;
}
