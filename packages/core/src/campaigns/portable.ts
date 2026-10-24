import type { Prisma, PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { audit } from "../audit";
import { campaignFields, scheduleSchema } from "./schema";
import { CampaignError, liveCampaign } from "./service";
import { assertTotalDelay, getSequence, stepPatch, triggerSchema, variantInput } from "./sequence";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
type Actor = string | null | undefined;

const { ownerId, ...settingFields } = campaignFields;
void ownerId; // a user id: never exported, never imported
const portableStep = z.strictObject({
  order: z.number().int().min(1),
  delayValue: stepPatch.shape.delayValue.unwrap(),
  delayUnit: stepPatch.shape.delayUnit.unwrap(),
  variants: z
    .array(
      z.strictObject({
        label: z.string().regex(/^[A-Z]$/),
        subject: variantInput.shape.subject,
        body: variantInput.shape.body,
        weight: variantInput.shape.weight,
        active: z.boolean(),
      }),
    )
    .max(26)
    .refine((v) => new Set(v.map((x) => x.label)).size === v.length, "duplicate_label"),
});
const steps = z.array(portableStep).max(100);
export const portableSchema = z.strictObject({
  version: z.literal(1),
  campaign: z
    .strictObject({
      ...settingFields,
      // exports from before the metric became an enum carried free text: read as "no metric" (reply)
      abWinnerMetric: z.preprocess(
        (v) => (["reply", "click", "open"].includes(v as string) ? v : null),
        settingFields.abWinnerMetric,
      ),
    })
    .partial()
    .required({ name: true }),
  schedules: z.array(scheduleSchema).max(10),
  steps,
  subsequences: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        trigger: triggerSchema,
        preDelayMinutes: z.number().int().min(0),
        dailyLimit: z.number().int().min(1).nullable(),
        active: z.boolean(),
        steps,
      }),
    )
    .max(50),
  accountIds: z.array(z.string().min(1)).max(100).optional(), // hand-added; resolved in this workspace only
});
const MAX_IMPORT_CHARS = 5_000_000;
export type CampaignExport = z.infer<typeof portableSchema>;

const pick = <T extends object>(o: T, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k as keyof T]]));
const plain = (v: unknown) => (v && typeof v === "object" && "toNumber" in v ? Number(v) : v);

/** Settings, schedules, steps with variants, subsequences. No ids, leads, accounts, owner or secrets. */
export async function exportCampaign(db: Db | Tx, ws: string, id: string): Promise<CampaignExport> {
  const c = await liveCampaign(db, ws, id);
  const [schedules, seq] = await Promise.all([
    db.campaignSchedule.findMany({ where: { campaignId: id }, orderBy: { id: "asc" } }),
    getSequence(db, ws, id),
  ]);
  const mapSteps = (list: typeof seq.steps) =>
    list.map((s, i) => ({
      order: i + 1,
      delayValue: s.delayValue,
      delayUnit: s.delayUnit,
      variants: s.variants.map((v) => pick(v, ["label", "subject", "body", "weight", "active"])),
    })) as CampaignExport["steps"];
  return {
    version: 1,
    campaign: Object.fromEntries(
      Object.entries(pick(c, Object.keys(settingFields))).map(([k, v]) => [k, plain(v)]),
    ) as CampaignExport["campaign"],
    schedules: schedules.map((s) =>
      pick(s, ["name", "timezone", "days", "from", "to"]),
    ) as CampaignExport["schedules"],
    steps: mapSteps(seq.steps),
    subsequences: seq.subsequences.map((s) => ({
      ...(pick(s, ["name", "preDelayMinutes", "dailyLimit", "active"]) as {
        name: string;
        preDelayMinutes: number;
        dailyLimit: number | null;
        active: boolean;
      }),
      trigger: s.trigger as z.infer<typeof triggerSchema>,
      steps: mapSteps(s.steps),
    })),
  };
}

async function create(
  tx: Tx,
  ws: string,
  actorId: Actor,
  doc: CampaignExport,
  action: "campaign.import" | "campaign.duplicate",
  meta: Record<string, string | number | boolean | null | string[]>,
) {
  const accountIds = [...new Set(doc.accountIds ?? [])];
  if (
    accountIds.length &&
    (await tx.emailAccount.count({
      where: { id: { in: accountIds }, workspaceId: ws, deletedAt: null },
    })) !== accountIds.length
  )
    throw new CampaignError(400, "unknown_account");
  const d = doc.campaign;
  if ((d.cc?.length ?? 0) + (d.bcc?.length ?? 0) > 10) throw new CampaignError(400, "cc_bcc_limit");
  const tz = (await tx.workspace.findUniqueOrThrow({ where: { id: ws } })).timezone;
  // Text-only wins over open tracking (PS-CAMP-22), as in createCampaign.
  const c = await tx.campaign.create({
    data: {
      ...d,
      ...(d.textOnly && { trackOpens: false }),
      workspaceId: ws,
      schedules: { create: doc.schedules.map((s) => ({ ...s, timezone: s.timezone ?? tz })) },
      accounts: { create: accountIds.map((accountId) => ({ accountId })) },
    },
  });
  const addSteps = async (list: CampaignExport["steps"], subsequenceId: string | null) => {
    const sorted = [...list].sort((a, b) => a.order - b.order);
    assertTotalDelay(sorted);
    for (const [i, s] of sorted.entries())
      await tx.sequenceStep.create({
        data: {
          campaignId: c.id,
          subsequenceId,
          order: i + 1,
          delayValue: !subsequenceId && i === 0 ? 0 : s.delayValue,
          delayUnit: s.delayUnit,
          variants: { create: s.variants },
        },
      });
  };
  await addSteps(doc.steps, null);
  for (const s of doc.subsequences) {
    const { steps: ss, ...sub } = s;
    const row = await tx.subsequence.create({
      data: { ...sub, campaignId: c.id, activatedAt: sub.active ? new Date() : null },
    });
    await addSteps(ss, row.id);
  }
  await audit(tx, { workspaceId: ws, actorId }, action, c.id, meta);
  return c;
}

/** A DRAFT copy of settings, schedules, steps, variants and subsequences. No leads, accounts, stats or sends. */
export async function duplicateCampaign(prisma: Db, ws: string, actorId: Actor, id: string) {
  return prisma.$transaction(async (tx) => {
    const doc = await exportCampaign(tx, ws, id);
    doc.campaign.name = `${doc.campaign.name} (copy)`.slice(0, 200);
    return create(tx, ws, actorId, doc, "campaign.duplicate", { from: id });
  });
}

/** Strictly validated; creates a DRAFT. Templates are checked at launch (their custom fields need leads). */
export async function importCampaign(prisma: Db, ws: string, actorId: Actor, json: unknown) {
  if (JSON.stringify(json ?? null).length > MAX_IMPORT_CHARS)
    throw new CampaignError(413, "import_too_large");
  const doc = portableSchema.parse(json);
  return prisma.$transaction((tx) => create(tx, ws, actorId, doc, "campaign.import", {}), {
    timeout: 30_000,
  });
}
