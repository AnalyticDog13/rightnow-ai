import type {
  AiSuggestion,
  AiSuggestionKind,
  Prisma,
  PrismaClient,
  SuggestionStatus,
} from "@rightnow/db/client";
import { z } from "zod";
import { AccountError, notFound } from "../accounts/service";
import { scopeAllows } from "../apikeys";
import { audit } from "../audit";
import type { Clock } from "../clock";

type Db = PrismaClient | Prisma.TransactionClient;

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
 * becomes `Lead.personalization` exactly as written (templates do not re-parse merge values, R16); the drafts are returned for a human to save or send.
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
    if (status === "APPROVED" && s.kind === "PERSONALIZATION" && s.leadId) {
      const wrote = await tx.lead.updateMany({
        where: { id: s.leadId, workspaceId: ws, deletedAt: null },
        data: { personalization: s.text },
      });
      if (!wrote.count) throw new AccountError(404, "lead_not_found"); // rolls the approval back
    }
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

/** Kinds made from a thread's messages: an API key without `inbox:read` does not see them (I1). */
const THREAD_KINDS: AiSuggestionKind[] = ["SUMMARY", "REPLY_DRAFT", "FOLLOWUP"];

/**
 * `c.scopes` is set for an API key: no thread-derived kinds without `inbox:read`; without `leads:read` no `lead` block
 * and no PERSONALIZATION (its text is written from the lead's fields).
 */
export async function listSuggestions(
  db: Db,
  ws: string,
  input: unknown,
  c: { scopes?: string[] } = {},
) {
  const { cursor, take = 50, ...f } = suggestionQuery.parse(input);
  const has = (s: string) => !c.scopes || scopeAllows(c.scopes, s);
  const hidden: AiSuggestionKind[] = [
    ...(has("inbox:read") ? [] : THREAD_KINDS),
    ...(has("leads:read") ? [] : (["PERSONALIZATION"] as const)),
  ];
  const where = {
    workspaceId: ws,
    ...f,
    ...(hidden.length && { AND: [{ kind: { notIn: hidden } }] }),
  };
  const [rows, total] = await Promise.all([
    db.aiSuggestion.findMany({
      where,
      // who the text is for: the reviewer must see it (the lead's email, name and company, nothing else)
      ...(has("leads:read") && {
        include: {
          lead: { select: { email: true, firstName: true, lastName: true, companyName: true } },
        },
      }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor && { cursor: { id: cursor } }),
    }),
    db.aiSuggestion.count({ where }),
  ]);
  const next = rows.length > take ? rows.pop()! : null;
  return {
    suggestions: rows as (AiSuggestion & {
      status: SuggestionStatus;
      lead: {
        email: string;
        firstName: string | null;
        lastName: string | null;
        companyName: string | null;
      } | null;
    })[],
    nextCursor: next?.id ?? null,
    total,
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
    // only what the AI classified (the thread's category source is AI) can be rated
    where: { id: messageId, workspaceId: ws, direction: "IN", thread: { categorySource: "AI" } },
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
