import { randomUUID } from "node:crypto";
import type { EmailAccount, Prisma, PrismaClient, SyncMode } from "@rightnow/db/client";
import {
  AuthError,
  PermanentSendError,
  mapLimit,
  type Folder,
  type MailProvider,
  type RemoteMessage,
  type SyncCursor,
} from "@rightnow/providers";
import { recordProviderError } from "../accounts/health";
import { unwrapPrevious } from "../accounts/status";
import type { Clock } from "../clock";
import { withTxRetry } from "../dispatch";
import { computeLifecycle } from "../deliverability/lifecycle";
import { warmupReceipt } from "../deliverability/warmup";
import { classify, type AiClassifier } from "./classify";
import { codeOf, ingestMessage, sanitizeRemote, syntheticMessageId } from "./ingest";
import { applyInbound } from "./stoprules";

export type SyncDeps = {
  providerFor: (a: EmailAccount) => Promise<MailProvider>;
  /** The workspace's AI classifier (D47); memoized per run. */
  aiClassifyFor?: (ws: string) => Promise<AiClassifier | undefined>;
  /** Test-only: the sync lease length, default 10 min. */
  leaseMs?: number;
  env: { SYNC_POLL_SEC: number; SYNC_MAX_STALENESS_SEC: number };
  /** Test-only (M9): provider pages per run, default 10. */
  maxPages?: number;
  /** Test-only: page size asked of the provider (its own default otherwise). */
  pageSize?: number;
  /** Checked between messages: the run stops as `more` without skipping anything. */
  signal?: AbortSignal;
  /** Test-only: the warm-up reply draw (D36). */
  random?: () => number;
};
export type SyncResult = "caught_up" | "more" | "failed" | "skipped";

/** HISTORICAL (first sync) or FULL (expired cursor) import in progress (C1). Never sent to the browser whole. */
export type SyncProgress = {
  mode: "HISTORICAL" | "FULL";
  folder: Folder;
  pageToken: string | null;
  since: string;
  cursor: SyncCursor;
  startedAt: string;
  fetched: number;
};

const LEASE_MS = 10 * 60_000;
const OOO_MAX_MS = 90 * 86_400_000;
const MAX_PAGES = 10;
const PARALLEL = 4;
const ESCALATE_AT = 5;
const MAX_BACKOFF_SEC = 1800;
const AI_TIMEOUT_MS = 10_000;
const KEEP_RUNS = 50;
const DAY = 86_400_000;

class LeaseLost extends Error {}
class Stopped extends Error {}
/** An ingest failure; `code` names the message ("<code> msg=<id>") so repeated failures on it can be counted. */
class IngestFailed extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * One sync run of a mailbox under a row lease (`syncLeaseId`, 10 min, renewed after every page). Branch order (C1):
 * an import in progress resumes; no cursor starts a HISTORICAL import; otherwise incremental, and an expired cursor
 * starts a FULL import. Every message is ingested with its stop rules in one transaction before the cursor or the
 * import position moves past it. The freshness watermark moves only when caught up, to the run's start (an import's:
 * its first run's start), and never backwards.
 */
export async function reconcileAccount(
  prisma: PrismaClient,
  clock: Clock,
  accountId: string,
  deps: SyncDeps,
): Promise<SyncResult> {
  const lease = randomUUID();
  const start = clock.now();
  const leaseUntil = () => new Date(clock.now().getTime() + (deps.leaseMs ?? LEASE_MS));
  const got = await prisma.emailAccount.updateMany({
    where: {
      id: accountId,
      deletedAt: null,
      credentialsEnc: { not: null },
      OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: start } }],
    },
    data: {
      syncLeaseId: lease,
      syncLeaseUntil: leaseUntil(),
      lastSyncAttemptAt: start,
      syncState: "SYNCING",
    },
  });
  if (!got.count) return "skipped";
  const acct = await prisma.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
  const own = { id: accountId, syncLeaseId: lease };
  /** Lease-conditional write that also renews the lease (I6). */
  const save = async (data: Prisma.EmailAccountUpdateManyMutationInput) => {
    const r = await prisma.emailAccount.updateMany({
      where: own,
      data: { ...data, syncLeaseUntil: leaseUntil() },
    });
    if (!r.count) throw new LeaseLost();
  };
  const stats = { mode: "INCREMENTAL" as SyncMode, fetched: 0, note: null as string | null };
  const limit = deps.pageSize ? { limit: deps.pageSize } : {};

  let aiFor: Promise<AiClassifier | undefined> | undefined;
  const ai = () =>
    (aiFor ??= (deps.aiClassifyFor?.(acct.workspaceId) ?? Promise.resolve(undefined)).catch(
      () => undefined,
    ));
  const ingestAll = async (msgs: RemoteMessage[], historical: boolean) => {
    for (const raw of msgs) {
      if (deps.signal?.aborted) throw new Stopped();
      const m = sanitizeRemote(raw, start);
      const tag = `msg=${m.providerMessageId || m.rfcMessageId || syntheticMessageId(m)}`;
      try {
        await ingestOne(prisma, clock, acct, m, historical, await ai(), {
          random: deps.random,
          renew: () => save({}),
        });
      } catch (e) {
        if (e instanceof LeaseLost) throw e;
        if (!(await failedTwice(tag))) throw new IngestFailed(`${codeOf(e)} ${tag}`);
        // 3rd run failing on it (PA #1): store the headers only, so the cursor moves and its stop rules still run
        // the warm-up check still sees the original ids (a placeholder has no Message-ID to match)
        await ingestOne(
          prisma,
          clock,
          acct,
          { ...m, rfcMessageId: null, text: null, html: null, attachments: [] },
          historical,
          undefined,
          { random: deps.random, original: m },
        );
        stats.note = `placeholder ${codeOf(e)} ${tag}`;
        console.error(`sync: account ${acct.id} stored a header-only placeholder (${stats.note})`);
      }
      stats.fetched++;
    }
  };
  /** The last two runs of this mailbox both failed on this message. */
  const failedTwice = async (tag: string) => {
    const runs = await prisma.syncRun.findMany({
      where: { accountId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { error: true },
    });
    return runs.length === 2 && runs.every((r) => r.error?.endsWith(` ${tag}`));
  };

  /** Pulls pages; `done` carries the watermark and, after an import, the cursor to keep. */
  const pull = async (
    provider: MailProvider,
  ): Promise<{ done: false } | { done: true; watermark: Date; cursor?: SyncCursor }> => {
    let pages = 0;
    const max = deps.maxPages ?? MAX_PAGES;
    const startImport = async (mode: SyncProgress["mode"], since: Date) => {
      // the cursor is taken before listing, so nothing delivered meanwhile falls between the two
      const p: SyncProgress = {
        mode,
        folder: "INBOX",
        pageToken: null,
        since: since.toISOString(),
        cursor: await provider.currentCursor(),
        startedAt: start.toISOString(),
        fetched: 0,
      };
      await save({ syncProgress: p });
      return p;
    };

    let p = acct.syncProgress as SyncProgress | null;
    if (!p && !acct.syncCursor)
      p = await startImport("HISTORICAL", new Date(start.getTime() - acct.historyImportDays * DAY));
    if (!p) {
      let cursor = acct.syncCursor as SyncCursor;
      for (; pages < max; pages++) {
        const ch = await provider.listChangesSince(cursor, limit);
        if (ch.expired) {
          const last = acct.lastSyncCompletedAt?.getTime() ?? Infinity;
          p = await startImport(
            "FULL",
            new Date(Math.min(last - 2 * DAY, start.getTime() - 30 * DAY)),
          );
          break;
        }
        await ingestAll(ch.messages, false);
        if (ch.removed.length)
          await prisma.message.updateMany({
            where: { accountId, providerMessageId: { in: ch.removed }, remoteDeletedAt: null },
            data: { remoteDeletedAt: clock.now() },
          });
        cursor = ch.cursor;
        await save({ syncCursor: cursor as Prisma.InputJsonValue });
        if (!ch.hasMore) return { done: true, watermark: start };
      }
      if (!p) return { done: false };
    }

    stats.mode = p.mode;
    let restarted = false;
    while (pages < max) {
      let r: Awaited<ReturnType<MailProvider["listMessages"]>>;
      try {
        r = await provider.listMessages({
          since: new Date(p.since),
          folder: p.folder,
          ...(p.pageToken ? { pageToken: p.pageToken } : {}),
          ...limit,
        });
      } catch (e) {
        // M11: a stored page token the provider no longer accepts restarts the folder (ingest is idempotent)
        if (!p.pageToken || !(e instanceof PermanentSendError) || restarted) throw e;
        restarted = true;
        p = { ...p, pageToken: null };
        continue;
      }
      pages++;
      await ingestAll(r.messages, p.mode === "HISTORICAL");
      const fetched: number = p.fetched + r.messages.length;
      if (!r.nextPageToken && p.folder === "SENT")
        return { done: true, watermark: new Date(p.startedAt), cursor: p.cursor };
      p = r.nextPageToken
        ? { ...p, pageToken: r.nextPageToken, fetched }
        : { ...p, folder: "SENT", pageToken: null, fetched };
      await save({ syncProgress: p });
    }
    return { done: false };
  };

  let result: SyncResult;
  let error: string | null = null;
  try {
    const out = await pull(await deps.providerFor(acct));
    if (out.done) {
      const w = out.watermark.toISOString();
      const cursor = out.cursor ? JSON.stringify(out.cursor) : null;
      // a caught-up run also clears a SYNC escalation (I3), restoring the error it covered (D39); CONNECTED unless that
      // restored error is a connection problem. A SYNC kept under a health pause (SOFT_BOUNCE) is dropped the same way.
      // D33: the idle check commits with the watermark, so the first claim that sees the account fresh sees its lifecycle.
      await prisma.$transaction(async (tx) => {
        const n = await tx.$executeRaw`
        UPDATE "EmailAccount" SET
          "lastSyncCompletedAt" = GREATEST(COALESCE("lastSyncCompletedAt", ${w}::timestamp), ${w}::timestamp),
          "syncCursor" = COALESCE(${cursor}::jsonb, "syncCursor"),
          "syncProgress" = NULL, "syncErrors" = 0, "syncState" = 'IDLE',
          "syncLeaseId" = NULL, "syncLeaseUntil" = NULL,
          status = CASE
            WHEN "lastError"->>'kind' = 'SYNC'
              AND "lastError"->'previous'->>'kind' IS DISTINCT FROM 'CONNECTION' THEN 'CONNECTED'::"AccountStatus"
            WHEN "lastError"->>'kind' = 'SOFT_BOUNCE' AND "lastError"->'previous'->>'kind' = 'SYNC'
              AND "lastError"->'previous'->'previous'->>'kind' IS DISTINCT FROM 'CONNECTION' THEN 'CONNECTED'::"AccountStatus"
            ELSE status END,
          "lastError" = CASE
            WHEN "lastError"->>'kind' = 'SYNC' THEN "lastError"->'previous'
            WHEN "lastError"->>'kind' = 'SOFT_BOUNCE' AND "lastError"->'previous'->>'kind' = 'SYNC'
              THEN ${unwrapPrevious}
            ELSE "lastError" END
        WHERE id = ${accountId} AND "syncLeaseId" = ${lease}`;
        if (!n) throw new LeaseLost();
        await computeLifecycle(tx, clock, accountId, {
          lookaheadSec: deps.env.SYNC_MAX_STALENESS_SEC,
        });
      });
      result = "caught_up";
    } else result = await release(prisma, own);
  } catch (e) {
    if (e instanceof LeaseLost) {
      result = "skipped";
      error = "lease_lost";
    } else if (e instanceof Stopped) result = await release(prisma, own);
    else {
      result = "failed";
      error = codeOf(e);
      await fail(prisma, clock, acct, lease, e, error);
    }
  }
  await prisma.syncRun.create({
    data: {
      accountId,
      mode: stats.mode,
      startedAt: start,
      finishedAt: clock.now(),
      fetched: stats.fetched,
      error: error ?? stats.note,
    },
  });
  await prisma.$executeRaw`
    DELETE FROM "SyncRun" WHERE "accountId" = ${accountId} AND id NOT IN (
      SELECT id FROM "SyncRun" WHERE "accountId" = ${accountId}
      ORDER BY "startedAt" DESC, id DESC LIMIT ${KEEP_RUNS})`;
  return result;
}

/** Ends a run that stopped early: the lease goes, `SYNCING` stays, so syncDue picks it up on the next tick (M10). */
async function release(prisma: PrismaClient, own: { id: string; syncLeaseId: string }) {
  const r = await prisma.emailAccount.updateMany({
    where: own,
    data: { syncLeaseId: null, syncLeaseUntil: null },
  });
  return r.count ? ("more" as const) : ("skipped" as const);
}

/** AuthError → account health (NEEDS_ATTENTION unless paused); anything else counts toward the SYNC escalation (I3). */
async function fail(
  prisma: PrismaClient,
  clock: Clock,
  acct: EmailAccount,
  lease: string,
  e: unknown,
  code: string,
) {
  if (!(e instanceof AuthError)) console.error(`sync: account ${acct.id} failed (${code})`);
  const done = { syncState: "FAILED" as const, syncLeaseId: null, syncLeaseUntil: null };
  const own = { id: acct.id, syncLeaseId: lease };
  if (e instanceof AuthError) {
    await recordProviderError(prisma, clock, acct.id, e);
    await prisma.emailAccount.updateMany({ where: own, data: done });
    return;
  }
  // sending is already blocked by staleness; escalation only makes the failure visible
  const n = acct.syncErrors + 1; // only the lease holder writes syncErrors
  if (n < ESCALATE_AT) {
    await prisma.emailAccount.updateMany({ where: own, data: { ...done, syncErrors: n } });
    return;
  }
  // D39: an earlier non-SYNC error (e.g. SENDING) is kept as `previous`, read in the same statement, never overwritten.
  // An older SYNC nested under a health pause goes too, or it would outlive this one and show after a resume.
  const error = { kind: "SYNC", code, message: `mailbox sync failed ${n} times in a row` };
  await prisma.$executeRaw`
    UPDATE "EmailAccount" SET "syncState" = 'FAILED', "syncLeaseId" = NULL, "syncLeaseUntil" = NULL,
      "syncErrors" = ${n}::int, status = 'ERROR', "lastErrorAt" = ${clock.now().toISOString()}::timestamp,
      "lastError" = ${JSON.stringify(error)}::jsonb || (SELECT CASE WHEN p IS NULL OR p = 'null' THEN '{}'::jsonb
        WHEN p->>'kind' = 'SOFT_BOUNCE' AND p->'previous'->>'kind' = 'SYNC' THEN jsonb_build_object('previous',
          CASE WHEN p->'previous'->'previous' IS NULL THEN p - 'previous'
          ELSE jsonb_set(p, '{previous}', p->'previous'->'previous') END)
        ELSE jsonb_build_object('previous', p) END
        FROM (SELECT CASE WHEN "lastError"->>'kind' = 'SYNC' THEN "lastError"->'previous' ELSE "lastError" END) x(p))
    WHERE id = ${acct.id} AND "syncLeaseId" = ${lease}`;
}

/** classify (+ the AI hook for an uncertain reply, outside any transaction), then ingest + stop rules in ONE transaction. */
async function ingestOne(
  prisma: PrismaClient,
  clock: Clock,
  acct: EmailAccount,
  m: RemoteMessage,
  historical: boolean,
  ai?: AiClassifier,
  o: { random?: () => number; original?: RemoteMessage; renew?: () => Promise<void> } = {},
) {
  const direction = m.from.email.toLowerCase() === acct.email.toLowerCase() ? "OUT" : "IN";
  let c = classify(m, { now: m.date, direction });
  // warm-up / placement traffic (D36, Rev 2 I1) is stored nowhere else: before the AI hook, matching and stop rules
  if (
    await prisma.$transaction((tx) => warmupReceipt(tx, clock, acct, o.original ?? m, c, o.random))
  )
    return;
  const rfc = m.rfcMessageId ?? syntheticMessageId(m);
  const stored = () =>
    prisma.message.findUnique({
      where: { accountId_rfcMessageId: { accountId: acct.id, rfcMessageId: rfc } },
      select: { id: true },
    });
  const want =
    c.kind === "REPLY" && c.category === "UNCERTAIN"
      ? "reply"
      : c.kind === "AUTO_REPLY" && c.category === "OUT_OF_OFFICE" && !c.oooUntil
        ? "ooo"
        : null;
  if (ai && want && !historical && !(await stored())) {
    // raced, not trusted to honour the signal: a hung classifier must not hold the run
    let timer: NodeJS.Timeout | undefined;
    const r = await Promise.race([
      ai(m, AbortSignal.timeout(AI_TIMEOUT_MS), want).catch(() => null),
      new Promise<null>((res) => (timer = setTimeout(() => res(null), AI_TIMEOUT_MS))),
    ]);
    clearTimeout(timer);
    await o.renew?.(); // the model call took seconds: keep the lease (a lost one stops the run)
    if (c.kind === "REPLY" && r && (r.category || r.label))
      c = {
        kind: "REPLY",
        category: r.category ?? c.category,
        source: r.category && r.category !== "UNCERTAIN" ? "AI" : "RULE",
        ...(r.label && { label: r.label }),
      };
    // a smart-pause date is used only when it is ahead of the message and within 90 days (PS-AI-10)
    else if (
      c.kind === "AUTO_REPLY" &&
      r?.oooUntil &&
      r.oooUntil > m.date &&
      r.oooUntil.getTime() - m.date.getTime() <= OOO_MAX_MS
    )
      c = { ...c, oooUntil: r.oooUntil };
  }
  // withTxRetry: a P2034 from a twin ingest in another mailbox reruns the whole transaction (D26 counters)
  const once = () =>
    withTxRetry(() =>
      prisma.$transaction(async (tx) => {
        const r = await ingestMessage(tx, acct, m, c, { historical });
        if (r.created)
          await applyInbound(tx, clock, {
            workspaceId: acct.workspaceId,
            message: await tx.message.findUniqueOrThrow({ where: { id: r.messageId } }),
            classification: c,
            match: r.match,
          });
      }),
    );
  try {
    try {
      await once();
    } catch (e) {
      // the sender's recordOutboundMessage stored the same message meanwhile: rerun, which finds it (created:false)
      if ((e as { code?: string }).code !== "P2002") throw e;
      await once();
    }
  } catch (e) {
    console.error(
      `sync: account ${acct.id} message ${m.providerMessageId} not ingested (${codeOf(e)})`,
    );
    throw e;
  }
}

/**
 * Syncs the due accounts, 4 at a time: live, with credentials, not NEEDS_ATTENTION, lease free, and never attempted, or
 * whose last run stopped early (`SYNCING`), or attempted at least SYNC_POLL_SEC ago (after errors:
 * min(SYNC_POLL_SEC · 2^(syncErrors−1), 1800) s). No new account starts after `maxMs` or once `signal` fired.
 */
export async function syncDue(
  prisma: PrismaClient,
  clock: Clock,
  deps: SyncDeps,
  o: { maxMs: number; signal?: AbortSignal } = { maxMs: 50_000 },
): Promise<{ synced: number; failed: number }> {
  const now = clock.now().toISOString();
  const poll = deps.env.SYNC_POLL_SEC;
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "EmailAccount"
    WHERE "deletedAt" IS NULL AND "credentialsEnc" IS NOT NULL AND lifecycle <> 'NEEDS_ATTENTION'
      AND ("syncLeaseUntil" IS NULL OR "syncLeaseUntil" < ${now}::timestamp)
      AND ("lastSyncAttemptAt" IS NULL OR "syncState" = 'SYNCING'
           OR "lastSyncAttemptAt" <= ${now}::timestamp - make_interval(secs =>
                LEAST(${poll}::int * power(2, GREATEST("syncErrors" - 1, 0)), ${MAX_BACKOFF_SEC}::int)))
    ORDER BY "lastSyncAttemptAt" ASC NULLS FIRST, id`;
  const signal = AbortSignal.any([AbortSignal.timeout(o.maxMs), ...(o.signal ? [o.signal] : [])]);
  const out = { synced: 0, failed: 0 };
  await mapLimit(due, PARALLEL, async ({ id }) => {
    if (signal.aborted) return;
    try {
      const r = await reconcileAccount(prisma, clock, id, { ...deps, signal });
      if (r === "failed") out.failed++;
      else if (r !== "skipped") out.synced++;
    } catch (e) {
      out.failed++;
      console.error(`syncDue: account ${id} (${codeOf(e)})`);
    }
  });
  return out;
}
