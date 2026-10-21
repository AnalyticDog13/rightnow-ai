import type { ReplyCategory } from "@rightnow/db/client";
import type { RemoteMessage } from "@rightnow/providers";

export type ClassifyInput = Pick<
  RemoteMessage,
  "from" | "subject" | "text" | "html" | "headers" | "attachments"
>;
export type Classification =
  | {
      kind: "BOUNCE";
      bounceType: "HARD" | "SOFT" | "UNKNOWN";
      status: string | null;
      recipient: string | null;
      originalMessageId: string | null;
      reason: string;
    }
  | { kind: "AUTO_REPLY"; category: "OUT_OF_OFFICE" | "AUTOMATED"; oooUntil: Date | null }
  | { kind: "UNSUBSCRIBE" }
  | { kind: "REPLY"; category: ReplyCategory; source: "RULE" | "AI" }
  | { kind: "OUTBOUND" };
/** P7-T05 implements; called only for REPLY/UNCERTAIN, outside any transaction. */
export type AiClassifier = (m: ClassifyInput, signal: AbortSignal) => Promise<ReplyCategory | null>;

/** Stub: T02 replaces the body with the rule classifier. */
export function classify(
  _m: ClassifyInput,
  o: { now: Date; direction: "IN" | "OUT" },
): Classification {
  return o.direction === "OUT"
    ? { kind: "OUTBOUND" }
    : { kind: "REPLY", category: "UNCERTAIN", source: "RULE" };
}
