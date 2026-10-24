import { createHash } from "node:crypto";
import type { PrismaClient } from "@rightnow/db/client";
import { HttpOutError, parseRetryAfter, safeRequest } from "@rightnow/providers";
import { AccountError } from "../accounts/service";
import type { Clock } from "../clock";
import { hit } from "../ratelimit";
import type { OutEnv } from "../webhooks/deliver";
import { loadAiConfig } from "./settings";

const TIMEOUT_MS = 30_000;
const MAX_RESPONSE = 1024 * 1024;

export type AiEnv = OutEnv & { signal?: AbortSignal; fetchFn?: typeof safeRequest };

/** Fail with a short code: never a response body, a prompt or the key (D47). */
const fail = (code: string) => new AccountError(502, code);

/**
 * R13: the model asked us to slow down; `retryAfterSec` comes from `Retry-After` (default 5, capped at 120).
 * `local`: our own 30-per-minute workspace bucket refused the call (D49), a 429 the route passes on with `Retry-After`.
 */
export class AiRateLimited extends AccountError {
  constructor(
    readonly retryAfterSec: number,
    local = false,
  ) {
    super(
      local ? 429 : 502,
      local ? "rate_limited" : "ai_http_429",
      local ? { retryAfterSec } : undefined,
    );
  }
}

/** D49: AI calls per workspace per minute. */
const AI_PER_MIN = 30;

/**
 * One OpenAI-compatible `POST <baseUrl>/chat/completions` through the shared outbound guard (pinned IP, no redirects,
 * capped body). Every call, failed or not, writes an AiCall with the prompt's sha256 only. The caller holds no transaction.
 */
export async function aiComplete(
  prisma: PrismaClient,
  clock: Clock,
  ws: string,
  feature: string,
  p: { system: string; user: string; maxTokens: number },
  env: AiEnv,
): Promise<{ text: string; callId: string }> {
  const cfg = await loadAiConfig(prisma, ws);
  if (!cfg) throw new AccountError(412, "ai_not_configured");
  // R16: a classifier call refused here leaves the reply UNCERTAIN; the personalize job sleeps retryAfterSec (R13)
  const rl = await hit(prisma, `ws:${ws}:ai`, AI_PER_MIN, 60, clock.now());
  if (!rl.ok) throw new AiRateLimited(rl.retryAfterSec, true);
  const log = (status: string, errorCode: string | null, inT = 0, outT = 0) =>
    prisma.aiCall.create({
      data: {
        workspaceId: ws,
        feature,
        model: cfg.model,
        promptHash: createHash("sha256").update(`${p.system}\n${p.user}`).digest("hex"),
        inputTokens: inT,
        outputTokens: outT,
        costMicros:
          cfg.inputPricePerMTok === undefined && cfg.outputPricePerMTok === undefined
            ? null
            : BigInt(
                Math.round(
                  inT * (cfg.inputPricePerMTok ?? 0) + outT * (cfg.outputPricePerMTok ?? 0),
                ),
              ),
        status,
        errorCode,
        createdAt: clock.now(),
      },
      select: { id: true },
    });
  const refuse = async (code: string, err: Error = fail(code)): Promise<never> => {
    await log("error", code);
    throw err;
  };
  let res;
  try {
    res = await (env.fetchFn ?? safeRequest)(
      `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: p.maxTokens,
          messages: [
            { role: "system", content: p.system },
            { role: "user", content: p.user },
          ],
        }),
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: MAX_RESPONSE,
        allowPrivate: env.allowPrivate,
        resolve: env.resolve,
        signal: env.signal,
      },
    );
  } catch (e) {
    const code = e instanceof HttpOutError ? e.code : "";
    return refuse(
      code === "timeout"
        ? "ai_timeout"
        : code === "response_too_large"
          ? "ai_bad_response"
          : `ai_${code || "request_failed"}`,
    );
  }
  if (res.status === 429)
    return refuse(
      "ai_http_429",
      new AiRateLimited(parseRetryAfter(res.headers["retry-after"] ?? null, clock.now(), 5, 120)),
    );
  if (res.status >= 300) return refuse(`ai_http_${res.status}`);
  let text: unknown;
  let usage: { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  try {
    if (res.body.length > MAX_RESPONSE) throw new Error("too large");
    const j = JSON.parse(res.body.toString("utf8")) as {
      choices?: { message?: { content?: unknown } }[];
      usage?: typeof usage;
    };
    text = j.choices?.[0]?.message?.content;
    usage = j.usage;
  } catch {
    return refuse("ai_bad_response");
  }
  if (typeof text !== "string") return refuse("ai_bad_response");
  const n = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0;
  const call = await log("ok", null, n(usage?.prompt_tokens), n(usage?.completion_tokens));
  return { text, callId: call.id };
}
