import type {
  AiSuggestion,
  AiSuggestionKind,
  Prisma,
  PrismaClient,
  SuggestionStatus,
} from "@rightnow/db/client";
import { z } from "zod";
import { AccountError, notFound } from "../accounts/service";
import { audit } from "../audit";
import type { Clock } from "../clock";

type Db = PrismaClient | Prisma.TransactionClient;

/** Model output is never parsed as template syntax once it sits in a lead field: "{{" -> "{ {", "}}" -> "} }". */
export const escapeTemplate = (s: string) => s.replaceAll("{{", "{ {").replaceAll("}}", "} }");

export async function createSuggestion(
  db: Db,
  ws: string,
  s: {
    kind: AiSuggestionKind;
    text: string;
    data?: object;
    leadId?: string;
    threadId?: string;
    campaignId?: string;
    stepId?: string;
    jobId?: string;
  },
  callId: string,
): Promise<AiSuggestion> {
  const row = await db.aiSuggestion.create({
    data: { ...s, data: (s.data ?? {}) as Prisma.InputJsonObject, workspaceId: ws },
  });
  await db.aiCall.updateMany({
    where: { id: callId, workspaceId: ws },
    data: { suggestionId: row.id },
  });
  return row;
}

/**
 * The ONLY writer of `AiSuggestion.status` and the only code that copies AI text into a lead (D47): PERSONALIZATION
 * becomes `Lead.personalization` (template-neutralized); the drafts are returned for a human to save or send.
 * Conditional on PENDING, so a second review is 409. Runs in one transaction; no network call.
 */
export async function reviewSuggestion(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actor: string | null | undefined,
  id: string,
  status: "APPROVED" | "REJECTED",
): Promise<{ suggestion: AiSuggestion; text: string | null }> {
  return prisma.$transaction(async (tx) => {
    const at = clock.now();
    const won = await tx.aiSuggestion.updateMany({
      where: { id, workspaceId: ws, status: "PENDING" },
      data: { status, reviewerId: actor ?? null, reviewedAt: at },
    });
    const s = await tx.aiSuggestion.findFirst({ where: { id, workspaceId: ws } });
    if (!s) throw notFound();
    if (!won.count) throw new AccountError(409, "already_reviewed");
    if (status === "APPROVED" && s.kind === "PERSONALIZATION" && s.leadId)
      await tx.lead.updateMany({
        where: { id: s.leadId, workspaceId: ws, deletedAt: null },
        data: { personalization: escapeTemplate(s.text) },
      });
    await audit(
      tx,
      { workspaceId: ws, actorId: actor, at },
      status === "APPROVED" ? "ai.approve" : "ai.reject",
      id,
      {
        kind: s.kind,
      },
    );
    return { suggestion: s, text: status === "APPROVED" ? s.text : null };
  });
}

export const suggestionQuery = z.strictObject({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  kind: z
    .enum([
      "DRAFT",
      "PERSONALIZATION",
      "FOLLOWUP",
      "REPLY_DRAFT",
      "SUMMARY",
      "SCORE",
      "RECOMMENDATION",
      "CAMPAIGN_ANALYSIS",
    ])
    .optional(),
  leadId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});
export const suggestionReview = z.strictObject({ status: z.enum(["APPROVED", "REJECTED"]) });
export const aiFeedbackInput = z.strictObject({ vote: z.union([z.literal(1), z.literal(-1)]) });

export async function listSuggestions(db: Db, ws: string, input: unknown) {
  const { cursor, take = 50, ...f } = suggestionQuery.parse(input);
  const rows = await db.aiSuggestion.findMany({
    where: { workspaceId: ws, ...f },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor && { cursor: { id: cursor } }),
  });
  const next = rows.length > take ? rows.pop()! : null;
  return {
    suggestions: rows as (AiSuggestion & { status: SuggestionStatus })[],
    nextCursor: next?.id ?? null,
  };
}

/** Thumbs on an AI-tagged message (PS-AI-04). */
export async function setAiFeedback(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  actor: string | null | undefined,
  messageId: string,
  vote: 1 | -1,
) {
  const r = await prisma.message.updateMany({
    where: { id: messageId, workspaceId: ws },
    data: { aiFeedback: vote },
  });
  if (!r.count) throw notFound();
  await audit(
    prisma,
    { workspaceId: ws, actorId: actor, at: clock.now() },
    "ai.feedback",
    messageId,
    { vote },
  );
}
