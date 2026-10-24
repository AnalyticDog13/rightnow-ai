import type { ReplyCategory } from "@rightnow/db/client";
import type { RemoteMessage } from "@rightnow/providers";
import { stripQuoted } from "./quoted";

export { stripQuoted };

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
  | { kind: "COMPLAINT"; recipient: string | null; originalMessageId: string | null }
  | { kind: "UNSUBSCRIBE" }
  | { kind: "REPLY"; category: ReplyCategory; source: "RULE" | "AI"; label?: string }
  | { kind: "OUTBOUND" };
/** What the AI may add (D47): a category and an aiSelectable label for an UNCERTAIN reply, or the return date of an OOO. */
export type AiResult = { category?: ReplyCategory; label?: string; oooUntil?: Date };
/** Called outside any transaction: `reply` for a rule-UNCERTAIN reply, `ooo` for an OOO auto-reply with no date. */
export type AiClassifier = (
  m: ClassifyInput,
  signal: AbortSignal,
  want: "reply" | "ooo",
) => Promise<AiResult | null>;

/** Lead-interest delta per category (PS-INBOX-19). */
export const INTEREST_OF: Partial<Record<ReplyCategory, number>> = {
  INTERESTED: 1,
  MEETING_REQUESTED: 1,
  OUT_OF_OFFICE: 0,
  NOT_INTERESTED: -1,
  WRONG_PERSON: -2,
};

const hdr = (m: ClassifyInput, name: string) => m.headers[name]?.[0]?.trim() ?? null;
const partText = (m: ClassifyInput, type: string) =>
  m.attachments
    .filter((a) => a.contentType.toLowerCase().startsWith(type) && a.content)
    .map((a) => a.content!.subarray(0, MAX_TEXT).toString("utf8"))
    .join("\n");
// bounded quantifiers: an unbounded run here is quadratic on a long word (FR C1)
const EMAIL = /[\w.+'-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
/** Classifier regexes see only the head of the text (DSN fields and a reply's intent sit at the top). */
const MAX_TEXT = 64 * 1024;

/** An ARF feedback report (RFC 5965): the complainer and the Message-ID of our original, when the report carries them. */
function classifyComplaint(m: ClassifyInput): Classification | null {
  const ct = hdr(m, "content-type") ?? "";
  if (!/multipart\/report/i.test(ct) || !/feedback-report/i.test(ct)) return null;
  const report = partText(m, "message/feedback-report");
  const orig = `${partText(m, "text/rfc822-headers")}
${partText(m, "message/rfc822")}`;
  const rcpt = /^Original-Rcpt-To:\s*<?([^>\s]+)>?/im.exec(report)?.[1]?.toLowerCase() ?? null;
  return {
    kind: "COMPLAINT",
    recipient: rcpt,
    originalMessageId: /^message-id:\s*(<[^>]+>)/im.exec(orig)?.[1] ?? null,
  };
}

function classifyBounce(m: ClassifyInput, text: string): Classification | null {
  const local = m.from.email.toLowerCase().split("@")[0];
  const ct = hdr(m, "content-type") ?? "";
  const isReport = /multipart\/report/i.test(ct) && /delivery-status/i.test(ct);
  const dsnLike =
    /delivery (status|failure)|undeliver|could not be delivered|wasn'?t delivered|returned mail|failure notice|\b[45]\.\d{1,3}\.\d{1,3}\b|\b[45]\d\d\b/i.test(
      `${m.subject}\n${text}`,
    );
  if (!isReport && !((local === "mailer-daemon" || local === "postmaster") && dsnLike)) return null;

  // mailparser inlines message/delivery-status into text, other clients keep it as a part
  const dsn = `${partText(m, "message/delivery-status")}
${text}`;
  const orig = `${partText(m, "text/rfc822-headers")}\n${partText(m, "message/rfc822")}`;
  const field = (src: string, name: string) =>
    new RegExp(`^${name}:\\s*(?:[\\w-]+;\\s*)?(.+)$`, "im").exec(src)?.[1]?.trim() ?? null;
  const basic = /\b([45])\d\d\b(?![.\d])/.exec(text);
  const status =
    field(dsn, "Status")?.match(/[45]\.\d{1,3}\.\d{1,3}/)?.[0] ??
    /\b[45]\.\d{1,3}\.\d{1,3}\b/.exec(text)?.[0] ??
    (basic ? `${basic[1]}.0.0` : null);
  const recipient =
    (
      field(dsn, "Final-Recipient") ??
      field(dsn, "Original-Recipient") ??
      text.match(EMAIL)?.find((e) => !/^(mailer-daemon|postmaster)@/i.test(e)) ??
      null
    )?.toLowerCase() ?? null;
  const reason = (field(dsn, "Diagnostic-Code") ?? text.replace(/\s+/g, " ").trim()).slice(0, 300);

  const evidence = `${reason}\n${text}`;
  const hard =
    /^5\.1\./.test(status ?? "") ||
    status === "5.2.1" ||
    (status?.startsWith("5.") === true &&
      /user unknown|no such user|does not exist|address rejected|invalid recipient|mailbox unavailable|recipient not found/i.test(
        evidence,
      ) &&
      !/spam|policy|block|reputation|blacklist|denylist|dmarc|spf|dkim/i.test(evidence));
  const soft = status?.startsWith("4.") === true || status === "5.2.2";
  return {
    kind: "BOUNCE",
    bounceType: hard ? "HARD" : soft ? "SOFT" : "UNKNOWN",
    status,
    recipient,
    originalMessageId: /^message-id:\s*(<[^>]+>)/im.exec(orig)?.[1] ?? null,
    reason,
  };
}

// Month names by first three letters (English, German, French, Spanish); "juin"/"juil" are special-cased.
const MONTH3: Record<string, number> = {
  jan: 1,
  ene: 1,
  feb: 2,
  fev: 2,
  mar: 3,
  avr: 4,
  apr: 4,
  abr: 4,
  may: 5,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  ago: 8,
  aou: 8,
  sep: 9,
  oct: 10,
  okt: 10,
  nov: 11,
  dec: 12,
  dic: 12,
  dez: 12,
};
function monthOf(w: string): number | undefined {
  const n = w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return n.startsWith("juil") ? 7 : n.startsWith("juin") ? 6 : MONTH3[n.slice(0, 3)];
}
const WORD = "[a-zA-Zéûäôü]+";
const OOO_UNTIL = new RegExp(
  String.raw`\b(?:until|back on|return(?:ing)? on|back|zurück am|de retour le)\s+(?:on\s+)?(?:` +
    String.raw`(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{1,2})\/(\d{1,2})\/(\d{4})|` +
    String.raw`(\d{1,2})(?:st|nd|rd|th)?\.?\s+(${WORD})\.?(?:,?\s+(\d{4}))?|(${WORD})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?)`,
  "gi",
);

function parseOooUntil(text: string, now: Date): Date | null {
  for (const g of text.matchAll(OOO_UNTIL)) {
    const t = oooDate(g, now);
    if (t) return t;
  }
  return null;
}

function oooDate(g: RegExpMatchArray, now: Date): Date | null {
  const n = (i: number) => (g[i] ? Number(g[i]) : undefined);
  let y: number | undefined, mo: number | undefined, d: number | undefined;
  if (g[1]) [y, mo, d] = [n(1), n(2), n(3)];
  else if (g[4]) [d, mo, y] = [n(4), n(5), n(6)];
  else if (g[7]) {
    // M/D/YYYY only when the day exceeds 12; otherwise D/M vs M/D is ambiguous
    if (Number(g[8]) <= 12) return null;
    [mo, d, y] = [n(7), n(8), n(9)];
  } else if (g[10]) [d, mo, y] = [n(10), monthOf(g[11]!), n(12)];
  else [mo, d, y] = [monthOf(g[13]!), n(14), n(15)];
  if (!mo || !d || mo > 12 || d > 31) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let t = new Date(Date.UTC(y ?? now.getUTCFullYear(), mo - 1, d));
  // a year-less date earlier than today means next year; today itself is already past
  if (y === undefined && t.getTime() < today)
    t = new Date(Date.UTC(now.getUTCFullYear() + 1, mo - 1, d));
  return t > now && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t : null; // past or Feb 30 -> null
}

const AUTO_SUBJECT =
  /^(out of (the )?office|automatic reply|auto(matic)?[- ]?reply|autoreply|abwesenheit|absence|fuera de la oficina|r[ée]ponse automatique)/i;
const OOO_WORDS =
  /out of (the )?office|on leave|vacation|\baway\b|abwesen|urlaub|absence|absent|fuera de la oficina|de vacaciones|en cong[ée]/i;

function isAutoReply(m: ClassifyInput): boolean {
  const auto = hdr(m, "auto-submitted");
  return (
    (auto !== null && auto.toLowerCase() !== "no") ||
    hdr(m, "x-autoreply") !== null ||
    hdr(m, "x-autorespond") !== null ||
    /^(all|oof)\b/i.test(hdr(m, "x-auto-response-suppress") ?? "") ||
    /^(auto_reply|bulk|junk)$/i.test(hdr(m, "precedence") ?? "") ||
    AUTO_SUBJECT.test(m.subject.trim())
  );
}

// negated forms ("don't remove me") are not requests
const UNSUB =
  /(?<!(?:don'?t|do not|never|not|won'?t)\s+)\b(unsubscribe|remove me|take me off|opt[ -]?out|stop (emailing|contacting))\b|\bdo not (contact|email)\b/i;
const UNSUB_ALONE =
  /^\W*(please\s+)?(unsubscribe|remove me|take me off|opt[ -]?out)\b[\w\s,.!-]{0,40}$/i;
const REQUEST = /\b(send|contract|call|go ahead)\b/i;
const ALL_SET = /we('re| are) all set\b(?!\s+(up|for|to))/gi;
const NOT_INTERESTED =
  /not interested|no,? thanks\b(?!\s+needed)|no thank you|not a (good )?fit|not for us|we(?:'ll| will)? pass on this/gi;
const WRONG_PERSON =
  /wrong person|not the right (person|contact)|no longer (with|at|works)|left the company/i;
const MEETING =
  /(book|schedule|set up|arrange) (a )?(call|meeting|time|demo)|calendly\.com|let'?s (talk|chat|meet)|free (on|next)|what time works/i;
const INTERESTED =
  /\binterested\b|sounds (good|great)|tell me more|send (me )?(more )?(info|details)|pricing|how much/i;

function replyCategory(body: string): ReplyCategory {
  // negated phrases are removed first so "not interested" does not also read as INTERESTED
  const noNeg = body.replace(NOT_INTERESTED, " ");
  const rest = noNeg.replace(ALL_SET, " ");
  const strong = noNeg !== body;
  const weak = rest !== noNeg; // "we're all set" is a decline only when nothing is asked for
  const meeting = MEETING.test(rest);
  const interested = INTERESTED.test(rest);
  if (strong || weak) {
    return meeting || interested || (weak && REQUEST.test(rest)) ? "UNCERTAIN" : "NOT_INTERESTED";
  }
  if (WRONG_PERSON.test(body)) return "WRONG_PERSON";
  return meeting ? "MEETING_REQUESTED" : interested ? "INTERESTED" : "UNCERTAIN";
}

export function classify(
  m: ClassifyInput,
  o: { now: Date; direction: "IN" | "OUT" },
): Classification {
  if (o.direction === "OUT") return { kind: "OUTBOUND" };
  const complaint = classifyComplaint(m);
  if (complaint) return complaint;
  const text = (m.text ?? "").slice(0, MAX_TEXT);
  const bounce = classifyBounce(m, text);
  if (bounce) return bounce;
  const body = stripQuoted(text);
  if (isAutoReply(m)) {
    const ooo = OOO_WORDS.test(`${m.subject}\n${body}`);
    return {
      kind: "AUTO_REPLY",
      category: ooo ? "OUT_OF_OFFICE" : "AUTOMATED",
      oooUntil: ooo ? parseOooUntil(`${m.subject}\n${body}`, o.now) : null,
    };
  }
  // signature and disclaimer lines are not requests: look at the text above a "-- " line only
  const own = body.split(/^-- ?$/m)[0]!;
  const lines = own.split("\n").filter((l) => l.trim());
  const short = lines.length <= 2 || own.length <= 200;
  const unsub = (short && UNSUB.test(own)) || lines.some((l) => UNSUB_ALONE.test(l));
  if (/^\s*unsubscribe\s*$/i.test(m.subject) || unsub) return { kind: "UNSUBSCRIBE" };
  return { kind: "REPLY", category: replyCategory(own), source: "RULE" };
}
