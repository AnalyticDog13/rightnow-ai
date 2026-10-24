import type { PrismaClient, ReplyCategory } from "@rightnow/db/client";
import type { Clock } from "../clock";
import type { AiClassifier } from "../mail/classify";
import { aiComplete, type AiEnv } from "./client";
import { classifyPrompt, oooPrompt } from "./prompts";
import { loadAiConfig } from "./settings";

const CATEGORIES = new Set<ReplyCategory>([
  "INTERESTED",
  "MEETING_REQUESTED",
  "NOT_INTERESTED",
  "WRONG_PERSON",
  "NEUTRAL",
  "UNCERTAIN",
]);

const json = (text: string): Record<string, unknown> | null => {
  const m = /\{[\s\S]*\}/.exec(text);
  try {
    const v: unknown = m && JSON.parse(m[0]);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * The workspace's reply classifier, or undefined when AI is off or "Use AI for uncertain replies" is unchecked. Built
 * once per sync run (labels read once). Calls the model outside any transaction; the caller renews its lease after each.
 */
export async function aiClassifierFor(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  env: AiEnv,
): Promise<AiClassifier | undefined> {
  const cfg = await loadAiConfig(prisma, ws);
  if (!cfg?.classifierEnabled) return undefined;
  const labels = await prisma.leadLabel.findMany({
    where: { workspaceId: ws, aiSelectable: true },
    select: { name: true, aiDescription: true },
    orderBy: { name: "asc" },
  });
  return async (m, signal, want) => {
    const prompt = want === "ooo" ? oooPrompt(m) : classifyPrompt(m, labels);
    const { text } = await aiComplete(
      prisma,
      clock,
      ws,
      want === "ooo" ? "classify_ooo" : "classify_reply",
      { ...prompt, maxTokens: 100 },
      { ...env, signal },
    );
    const out = json(text);
    if (!out) return null;
    if (want === "ooo") {
      const d =
        typeof out.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.until)
          ? new Date(`${out.until}T00:00:00Z`)
          : null;
      return d && !Number.isNaN(d.getTime()) ? { oooUntil: d } : null;
    }
    const category = CATEGORIES.has(out.category as ReplyCategory)
      ? (out.category as ReplyCategory)
      : undefined;
    const label =
      typeof out.label === "string" && labels.some((l) => l.name === out.label)
        ? out.label
        : undefined;
    return category || label ? { category, label } : null;
  };
}
