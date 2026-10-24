import type { BackgroundJob, Prisma, PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { AccountError, isPrismaCode, notFound } from "../accounts/service";
import { analytics } from "../analytics/metrics";
import { sleep, type Clock } from "../clock";
import { outEnv } from "../env";
import type { JobDeps } from "../jobs";
import { aiComplete, AiRateLimited, type AiEnv } from "./client";
import {
  analysisPrompt,
  draftPrompt,
  followupPrompt,
  personalizePrompt,
  recommendPrompt,
  replyDraftPrompt,
  scorePrompt,
  summaryPrompt,
} from "./prompts";
import { loadAiConfig } from "./settings";
import { createSuggestion } from "./suggestions";

/**
 * D47/T05b: one function per feature. Each builds an allowlisted prompt, asks the model and stores the answer; model text
 * is data. Recipient-facing kinds are stored PENDING and only `reviewSuggestion` can act on them. Nothing here sends mail,
 * writes lead text or approves anything; JSON answers are parsed strictly and clamped.
 */
const id = z.string().min(1).max(100);
export const draftInput = z.strictObject({
  stepId: id,
  tone: z.string().trim().min(1).max(100).default("friendly"),
  offer: z.string().trim().max(500).optional(),
});
export const personalizeInput = z.strictObject({
  leadIds: z.array(id).min(1).max(500),
  instruction: z.string().trim().max(500).optional(),
});
export const followupInput = z.strictObject({ leadId: id });
export const replyDraftInput = z.strictObject({ threadId: id });
export const summaryInput = z.strictObject({ threadId: id });
export const scoreInput = z.strictObject({ leadId: id });
export const recommendInput = z
  .strictObject({ leadId: id.optional(), opportunityId: id.optional() })
  .refine((v) => !!v.leadId !== !!v.opportunityId, "leadId or opportunityId");
export const campaignAnalysisInput = z.strictObject({ campaignId: id });

type Db = PrismaClient | Prisma.TransactionClient;
const bad = () => new AccountError(502, "ai_bad_response");

export const aiConfigured = async (db: Db, ws: string) => !!(await loadAiConfig(db, ws));

/** 412 before any other work, so an unconfigured workspace gets the same answer from every route. */
export async function requireAi(db: Db, ws: string) {
  if (!(await aiConfigured(db, ws))) throw new AccountError(412, "ai_not_configured");
}

/** Strict: a JSON object (optionally fenced), else 502 `ai_bad_response`; the shape is then checked by `schema`. */
function parseAnswer<T extends z.ZodType>(text: string, schema: T): z.infer<T> {
  let j: unknown;
  try {
    j = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw bad();
  }
  const r = schema.safeParse(j);
  if (!r.success) throw bad();
  return r.data;
}

const lead = async (db: Db, ws: string, leadId: string) =>
  (await db.lead.findFirst({ where: { id: leadId, workspaceId: ws, deletedAt: null } })) ??
  Promise.reject(notFound());

const messages = (db: Db, ws: string, threadId: string) =>
  db.message
    .findMany({
      where: { workspaceId: ws, threadId },
      orderBy: { sentAt: "desc" },
      take: 6,
      select: { direction: true, subject: true, text: true },
    })
    .then((m) => m.reverse());

const thread = async (db: Db, ws: string, threadId: string) =>
  (await db.thread.findFirst({ where: { id: threadId, workspaceId: ws, deletedAt: null } })) ??
  Promise.reject(notFound());

/** The lead's newest thread, for the follow-up, score and recommendation context. */
async function latestThread(db: Db, ws: string, leadId: string) {
  const t = await db.thread.findFirst({
    where: { workspaceId: ws, leadId, deletedAt: null },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });
  return t ? { id: t.id, msgs: await messages(db, ws, t.id) } : { id: undefined, msgs: [] };
}

const ask = (
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  feature: string,
  prompt: { system: string; user: string },
  maxTokens: number,
  env: AiEnv,
) => aiComplete(prisma, clock, ws, feature, { ...prompt, maxTokens }, env);

export async function draft(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  input: unknown,
  env: AiEnv,
) {
  const v = draftInput.parse(input);
  await requireAi(prisma, ws);
  const step = await prisma.sequenceStep.findFirst({
    where: { id: v.stepId, deletedAt: null, campaign: { workspaceId: ws, deletedAt: null } },
    include: {
      campaign: { select: { id: true, name: true } },
      variants: { where: { active: true }, orderBy: { label: "asc" }, take: 1 },
    },
  });
  if (!step) throw notFound();
  const cur = step.variants[0];
  const p = draftPrompt({
    tone: v.tone,
    offer: v.offer,
    campaign: step.campaign.name,
    subject: cur?.subject ?? "",
    body: cur?.body ?? "",
  });
  const r = await ask(prisma, clock, ws, "draft", p, 600, env);
  return createSuggestion(
    prisma,
    ws,
    {
      kind: "DRAFT",
      text: r.text,
      campaignId: step.campaign.id,
      stepId: step.id,
      data: { tone: v.tone },
    },
    r.callId,
  );
}

export async function followup(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  input: unknown,
  env: AiEnv,
) {
  const v = followupInput.parse(input);
  await requireAi(prisma, ws);
  const l = await lead(prisma, ws, v.leadId);
  const t = await latestThread(prisma, ws, l.id);
  const r = await ask(prisma, clock, ws, "followup", followupPrompt(l, t.msgs), 500, env);
  return createSuggestion(
    prisma,
    ws,
    { kind: "FOLLOWUP", text: r.text, leadId: l.id, threadId: t.id },
    r.callId,
  );
}

export async function replyDraft(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  input: unknown,
  env: AiEnv,
) {
  const v = replyDraftInput.parse(input);
  await requireAi(prisma, ws);
  const t = await thread(prisma, ws, v.threadId);
  const macros = await prisma.macro.findMany({
    where: { workspaceId: ws },
    orderBy: { name: "asc" },
    take: 3,
    select: { name: true, body: true },
  });
  const p = replyDraftPrompt(await messages(prisma, ws, t.id), macros);
  const r = await ask(prisma, clock, ws, "reply_draft", p, 500, env);
  return createSuggestion(
    prisma,
    ws,
    { kind: "REPLY_DRAFT", text: r.text, threadId: t.id, ...(t.leadId && { leadId: t.leadId }) },
    r.callId,
  );
}

/** No approval: a summary is for the reader, not the recipient. */
export async function summarize(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  input: unknown,
  env: AiEnv,
) {
  const v = summaryInput.parse(input);
  await requireAi(prisma, ws);
  const t = await thread(prisma, ws, v.threadId);
  const p = summaryPrompt(await messages(prisma, ws, t.id));
  const r = await ask(prisma, clock, ws, "summary", p, 300, env);
  return createSuggestion(prisma, ws, { kind: "SUMMARY", text: r.text, threadId: t.id }, r.callId);
}

// a finite number or a numeric string; null, "", [] and true are not scores
const scoreValue = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);
const scoreAnswer = z.object({ score: scoreValue, reason: z.string().default("") });

/** Writes `Lead.aiScore` (a number, never text a recipient sees); clamped, and nothing is written on a bad answer. */
export async function score(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  input: unknown,
  env: AiEnv,
) {
  const v = scoreInput.parse(input);
  await requireAi(prisma, ws);
  const l = await lead(prisma, ws, v.leadId);
  const p = scorePrompt(l, (await latestThread(prisma, ws, l.id)).msgs);
  const a = parseAnswer((await ask(prisma, clock, ws, "score", p, 200, env)).text, scoreAnswer);
  const out = {
    aiScore: Math.min(100, Math.max(0, Math.round(a.score))),
    aiScoreReason: a.reason.slice(0, 500),
  };
  await prisma.lead.updateMany({ where: { id: l.id, workspaceId: ws }, data: out });
  return out;
}

const recommendAnswer = z.object({
  actions: z
    .array(z.object({ title: z.string().trim().min(1), body: z.string().optional() }))
    .max(20),
});

/** The tasks are AWAITING_APPROVAL: a person turns them OPEN in the CRM (PS-CRM-08). At most 5. */
export async function recommend(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  input: unknown,
  env: AiEnv,
) {
  const v = recommendInput.parse(input);
  await requireAi(prisma, ws);
  let opp = null;
  if (v.opportunityId) {
    opp = await prisma.opportunity.findFirst({
      where: { id: v.opportunityId, workspaceId: ws },
      include: { stage: { select: { name: true } } },
    });
    if (!opp) throw notFound();
  }
  const l = await lead(prisma, ws, opp?.leadId ?? v.leadId!);
  const t = await latestThread(prisma, ws, l.id);
  const p = recommendPrompt(l, { thread: t.msgs, stage: opp?.stage.name, deal: opp?.title });
  const a = parseAnswer(
    (await ask(prisma, clock, ws, "recommend", p, 500, env)).text,
    recommendAnswer,
  );
  return prisma.$transaction(
    a.actions.slice(0, 5).map((x) =>
      prisma.task.create({
        data: {
          workspaceId: ws,
          title: x.title.slice(0, 200),
          body: x.body?.slice(0, 1000) ?? null,
          status: "AWAITING_APPROVAL",
          leadId: l.id,
          opportunityId: opp?.id ?? null,
        },
      }),
    ),
  );
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function analyzeCampaign(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  input: unknown,
  env: AiEnv,
) {
  const v = campaignAnalysisInput.parse(input);
  await requireAi(prisma, ws);
  const c = await prisma.campaign.findFirst({
    where: { id: v.campaignId, workspaceId: ws, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!c) throw notFound();
  const now = clock.now();
  const rep = await analytics(prisma, ws, {
    from: ymd(new Date(now.getTime() - 399 * 86_400_000)),
    to: ymd(now),
    tz: "UTC",
    campaignIds: [c.id],
    includeAutoReplies: false,
    replyBase: "contacted",
    groupBy: "variant",
  });
  const rows = [{ ...rep.total, label: "All variants" }, ...rep.rows].map((r) => ({
    ...r,
    n: r.rateBase,
  }));
  const r = await ask(
    prisma,
    clock,
    ws,
    "campaign_analysis",
    analysisPrompt(c.name, rows),
    800,
    env,
  );
  return createSuggestion(
    prisma,
    ws,
    { kind: "CAMPAIGN_ANALYSIS", text: r.text, campaignId: c.id },
    r.callId,
  );
}

/**
 * `ai_personalize` (JOB_HANDLERS): one PENDING suggestion per lead, `(jobId, leadId)` unique, so a rerun skips finished
 * leads. A rate-limit refusal sleeps `Retry-After` in 10 s slices that each report progress (R13: the job is not stale)
 * and retries, up to 5 times; other per-lead failures are counted and skipped.
 */
export async function personalizeJob(
  prisma: PrismaClient,
  clock: Clock,
  job: BackgroundJob,
  progress: (pct: number) => Promise<void>,
  signal: AbortSignal,
  deps: JobDeps,
) {
  const { leadIds: ids, instruction } = personalizeInput.parse(job.input);
  const leadIds = [...new Set(ids)];
  const ws = job.workspaceId;
  await requireAi(prisma, ws);
  const env: AiEnv = { ...outEnv(deps.env), signal };
  const stored = await prisma.aiSuggestion.findMany({
    where: { workspaceId: ws, jobId: job.id },
    select: { leadId: true },
  });
  const done = new Set(stored.map((x) => x.leadId));
  let pct = 0;
  await progress(pct);
  let created = 0;
  let failed = 0;
  for (const [i, leadId] of leadIds.entries()) {
    if (signal.aborted) break;
    const l = done.has(leadId)
      ? null
      : await prisma.lead.findFirst({ where: { id: leadId, workspaceId: ws, deletedAt: null } });
    if (l)
      try {
        for (let attempt = 0; ; attempt++)
          try {
            const r = await ask(
              prisma,
              clock,
              ws,
              "personalize",
              personalizePrompt(l, instruction),
              200,
              env,
            );
            const text = r.text.trim().slice(0, 1000);
            await createSuggestion(
              prisma,
              ws,
              { kind: "PERSONALIZATION", text, leadId, jobId: job.id },
              r.callId,
            );
            created++;
            break;
          } catch (e) {
            if (!(e instanceof AiRateLimited) || attempt >= 4 || signal.aborted) throw e;
            for (let left = e.retryAfterSec * 1000; left > 0 && !signal.aborted; left -= 10_000) {
              await sleep(Math.min(left, 10_000), signal);
              await progress(pct); // bumps updatedAt: a sleeping job is not stale
            }
            if (signal.aborted) break;
          }
      } catch (e) {
        if (e instanceof AccountError && e.message === "ai_not_configured") throw e;
        if (!isPrismaCode(e, "P2002")) failed++; // P2002: a concurrent run of this job already stored it
      }
    pct = Math.floor(((i + 1) * 100) / leadIds.length);
    await progress(pct);
  }
  return { created, failed };
}
