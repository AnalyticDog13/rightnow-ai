import { createHmac } from "node:crypto";
import type { Event, Prisma, PrismaClient } from "@rightnow/db/client";
import { HttpOutError, mapLimit, parseRetryAfter, safeRequest } from "@rightnow/providers";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { decrypt } from "../crypto";
import { getEnv } from "../env";
import { webhookEventName } from "./events";
import { buildPayload } from "./payload";

type Tx = Prisma.TransactionClient;
/** How a delivery reaches the user's URL: `ALLOW_PRIVATE_HTTP_HOSTS`, and a resolver tests inject. */
export type OutEnv = { allowPrivate: boolean; resolve?: (h: string) => Promise<string[]> };
/** The ACTIVE webhooks a dispatch batch loaded once. */
export type ActiveHook = {
  id: string;
  workspaceId: string;
  events: string[];
  campaignId: string | null;
};

/** Wait after failed attempt n (1-based); attempt 8 failing is final: about 23.6 h in all (PS-AUTO-08). */
export const BACKOFF_SEC = [60, 300, 1800, 7200, 18000, 28800, 28800];
const MAX_ATTEMPTS = BACKOFF_SEC.length + 1;
const DISABLE_AT = 20;
const RETRY_AFTER_MAX = 8 * 3600;
const LEASE_MS = 60_000;
const BATCH = 20;
const PARALLEL = 5;
const IDLE_MS = 2_000;

/** "t=<unix s>,v1=<hex HMAC-SHA256(secret, '<t>.<raw body>')>" (PS-AUTO-09). */
export const sign = (secret: string, t: number, body: string) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

/** Inserts one PENDING delivery per (webhook, event); a duplicate (rule + subscription) is skipped. */
async function insert(tx: Tx, e: Event, now: Date, webhookIds: string[]) {
  if (!webhookIds.length) return 0;
  const payload = await buildPayload(tx, e, getEnv().APP_URL);
  if (!payload) return 0;
  const r = await tx.webhookDelivery.createMany({
    data: webhookIds.map((webhookId) => ({
      workspaceId: e.workspaceId,
      webhookId,
      eventId: e.id,
      leadId: e.leadId,
      eventType: payload.event_type as string,
      payload: payload as Prisma.InputJsonObject,
      nextAttemptAt: now,
      createdAt: now,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

/** The dispatcher's hook (D43): deliveries for the ACTIVE webhooks subscribed to this Event. */
export function insertDeliveries(tx: Tx, e: Event, now: Date, hooks: ActiveHook[]) {
  const name = webhookEventName(e);
  if (!name) return Promise.resolve(0);
  const ids = hooks
    .filter(
      (h) =>
        h.workspaceId === e.workspaceId &&
        (!h.campaignId || h.campaignId === e.campaignId) &&
        (h.events.includes("all_events") || h.events.includes(name)),
    )
    .map((h) => h.id);
  return insert(tx, e, now, ids);
}

/** The `send_webhook` action: one delivery to that webhook when it is ACTIVE in the Event's workspace. */
export async function enqueueDelivery(tx: Tx, e: Event, now: Date, webhookId: string) {
  const w = await tx.webhook.count({
    where: { id: webhookId, workspaceId: e.workspaceId, status: "ACTIVE" },
  });
  return w ? insert(tx, e, now, [webhookId]) : 0;
}

type Target = { url: string; secretEnc: string; headersEnc: string | null };
type Outcome = {
  status: number | null;
  latencyMs: number;
  error: string | null;
  retryAfter?: string;
};

/** One signed POST through safeRequest; t and v1 are computed per attempt and never stored (M5). */
export async function postWebhook(
  w: Target,
  eventId: string,
  body: string,
  now: Date,
  env: OutEnv & { signal?: AbortSignal },
): Promise<Outcome> {
  const t = Math.floor(now.getTime() / 1000);
  const start = Date.now();
  try {
    const r = await safeRequest(w.url, {
      method: "POST",
      headers: {
        ...(w.headersEnc ? (JSON.parse(decrypt(w.headersEnc)) as Record<string, string>) : {}),
        "content-type": "application/json",
        "user-agent": "RightNow-Webhooks/1",
        "x-rightnow-event-id": eventId,
        "x-rightnow-timestamp": String(t),
        "x-rightnow-signature": sign(decrypt(w.secretEnc), t, body),
      },
      body,
      timeoutMs: 10_000,
      maxResponseBytes: 64 * 1024,
      allowPrivate: env.allowPrivate,
      resolve: env.resolve,
      signal: env.signal,
    });
    const ok = r.status >= 200 && r.status < 300;
    return {
      status: r.status,
      latencyMs: r.latencyMs,
      error: ok ? null : `http_${r.status}`,
      retryAfter: r.headers["retry-after"],
    };
  } catch (e) {
    const latencyMs = Date.now() - start;
    // a 2xx with an oversized body was still received: the body is only read and discarded
    if (e instanceof HttpOutError && e.status && e.status >= 200 && e.status < 300)
      return { status: e.status, latencyMs, error: null };
    const code = e instanceof HttpOutError ? e.code : "error";
    return {
      status: e instanceof HttpOutError ? (e.status ?? null) : null,
      latencyMs,
      error: code,
    };
  }
}

type Claimed = {
  id: string;
  attempts: number;
  payload: unknown;
  webhookId: string;
  eventId: string;
};

/**
 * The result write, conditional on our attempt (`SENDING` and `attempts = n`): a late write from an older attempt
 * changes nothing. Lock order: the delivery, then its webhook. A failure (not a 429) bumps the webhook counter in one
 * statement; the statement that flips it to ERROR fails its PENDING rows and audits once (R9). A row whose webhook is
 * ERROR ends FAILED `webhook_disabled`.
 */
async function record(prisma: PrismaClient, now: Date, d: Claimed, o: Outcome): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const own = await tx.$queryRaw<{ workspaceId: string }[]>`
      SELECT "workspaceId" FROM "WebhookDelivery" WHERE id = ${d.id} AND status = 'SENDING' AND attempts = ${d.attempts}
      FOR UPDATE`;
    if (!own.length) return false;
    const ws = own[0]!.workspaceId;
    const last = {
      lastStatus: o.status,
      lastLatencyMs: o.latencyMs,
      lastAttemptAt: now,
      leaseUntil: null,
    };
    if (!o.error) {
      await tx.webhookDelivery.update({
        where: { id: d.id },
        data: { ...last, status: "DELIVERED", deliveredAt: now, lastError: null },
      });
      await tx.webhook.updateMany({
        where: { id: d.webhookId, status: "ACTIVE", consecutiveFailures: { not: 0 } },
        data: { consecutiveFailures: 0 },
      });
      return true;
    }
    const [w] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text FROM "Webhook" WHERE id = ${d.webhookId} FOR NO KEY UPDATE`;
    let status = w?.status ?? "ERROR";
    if (status === "ACTIVE" && o.status !== 429) {
      const [r] = await tx.$queryRaw<{ status: string }[]>`
        UPDATE "Webhook" SET "consecutiveFailures" = "consecutiveFailures" + 1,
          status = CASE WHEN "consecutiveFailures" + 1 >= ${DISABLE_AT} THEN 'ERROR'::"WebhookStatus" ELSE status END,
          "disabledAt" = CASE WHEN "consecutiveFailures" + 1 >= ${DISABLE_AT} THEN ${now} ELSE "disabledAt" END,
          "lastError" = ${o.error}, "updatedAt" = ${now}
        WHERE id = ${d.webhookId} AND status = 'ACTIVE' RETURNING status::text`;
      status = r!.status; // we hold the row lock and read ACTIVE: ERROR here means this statement flipped it
      if (status === "ERROR") {
        await tx.webhookDelivery.updateMany({
          where: { webhookId: d.webhookId, status: "PENDING" },
          data: { status: "FAILED", lastError: "webhook_disabled" },
        });
        await audit(tx, { workspaceId: ws, at: now }, "webhook.disabled", d.webhookId, {
          lastError: o.error,
        });
      }
    }
    const wait = Math.max(
      BACKOFF_SEC[d.attempts - 1] ?? 0,
      o.retryAfter ? parseRetryAfter(o.retryAfter, now, 0, RETRY_AFTER_MAX) : 0,
    );
    const final = status === "ERROR" || d.attempts >= MAX_ATTEMPTS;
    await tx.webhookDelivery.update({
      where: { id: d.id },
      data: {
        ...last,
        status: final ? "FAILED" : "PENDING",
        lastError: status === "ERROR" ? "webhook_disabled" : o.error,
        ...(!final && { nextAttemptAt: new Date(now.getTime() + wait * 1000) }),
      },
    });
    return true;
  });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
  });

/**
 * D44 `webhook-deliver`: expired leases go back to PENDING (the attempt counts), then ≤ `limit` due rows of ACTIVE
 * webhooks are claimed in one statement (`FOR UPDATE OF d SKIP LOCKED`, SENDING, lease 60 s, attempts + 1) and POSTed
 * 5 at a time outside any transaction. Loops until `maxMs` (a 2 s sleep when idle) or `signal`.
 */
export async function deliverDue(
  prisma: PrismaClient,
  clock: Clock,
  o: OutEnv & { maxMs: number; signal?: AbortSignal; limit?: number },
): Promise<{ delivered: number; failed: number }> {
  const out = { delivered: 0, failed: 0 };
  const start = Date.now();
  for (;;) {
    const now = clock.now();
    await prisma.$executeRaw`
      UPDATE "WebhookDelivery" SET "leaseUntil" = NULL,
        status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'FAILED'::"DeliveryStatus" ELSE 'PENDING'::"DeliveryStatus" END,
        "lastError" = 'lease_expired', "nextAttemptAt" = ${now}
      WHERE status = 'SENDING' AND "leaseUntil" < ${now}`;
    const claimed = await prisma.$queryRaw<Claimed[]>`
      WITH c AS (
        SELECT d.id FROM "WebhookDelivery" d JOIN "Webhook" w ON w.id = d."webhookId"
        WHERE d.status = 'PENDING' AND d."nextAttemptAt" <= ${now} AND w.status = 'ACTIVE'
        ORDER BY d."nextAttemptAt", d.id LIMIT ${o.limit ?? BATCH} FOR UPDATE OF d SKIP LOCKED)
      UPDATE "WebhookDelivery" d SET status = 'SENDING', attempts = d.attempts + 1,
        "leaseUntil" = ${new Date(now.getTime() + LEASE_MS)}
      FROM c WHERE d.id = c.id
      RETURNING d.id, d.attempts, d.payload, d."webhookId", d."eventId"`;
    if (claimed.length) {
      const hooks = new Map(
        (
          await prisma.webhook.findMany({
            where: { id: { in: [...new Set(claimed.map((d) => d.webhookId))] } },
            select: { id: true, url: true, secretEnc: true, headersEnc: true },
          })
        ).map((w) => [w.id, w]),
      );
      await mapLimit(claimed, PARALLEL, async (d) => {
        const w = hooks.get(d.webhookId);
        if (!w) return; // deleted mid-run: its deliveries cascaded away
        const r = await postWebhook(w, d.eventId, JSON.stringify(d.payload), clock.now(), { ...o });
        // a worker shutdown is not the endpoint's failure: the row stays SENDING and its lease brings it back
        if (r.error && o.signal?.aborted) return;
        if (await record(prisma, clock.now(), d, r)) out[r.error ? "failed" : "delivered"]++;
      });
    }
    const left = o.maxMs - (Date.now() - start);
    if (o.signal?.aborted || left <= 0) return out;
    if (!claimed.length) await sleep(Math.min(IDLE_MS, left), o.signal);
  }
}
