import { Prisma, type EmailAccount, type PrismaClient } from "@rightnow/db/client";
import {
  AuthError,
  PermanentSendError,
  ProviderError,
  RateLimitedError,
  TransientBeforeSendError,
  buildMime,
  type MailProvider,
  type OutboundMime,
  type SendResult,
} from "@rightnow/providers";
import { recordProviderError } from "./accounts/health";
import type { Clock } from "./clock";
import { claimDue, withTxRetry, type ClaimOpts, type Claimed } from "./dispatch";
import { isSuppressed, suppress } from "./leads/suppression";
import { advanceLead } from "./planner";
import { commitUsage, creditSent, releaseUsage, type UsageRef } from "./quota";
import { isInWindow, nextWindowStart, type Window } from "./schedule";
import { listUnsubscribeHeaders, type RenderEnv } from "./unsubscribe";

type Tx = Prisma.TransactionClient;

export type SendOutcome =
  "SENT" | "RETRY" | "UNCERTAIN" | "FAILED" | "AUTH" | "STALE" | "RELEASED" | "CANCELLED" | "LOST";
export type SenderDeps = {
  providerFor: (a: EmailAccount) => MailProvider;
  env: RenderEnv;
  /** Backoff jitter (tests pin it). */
  random?: () => number;
};

/** The provider call is bounded far inside the lease (SEND_LEASE_SEC, default 600 s): 120 s stale check + 60 s. */
export const SEND_TIMEOUT_MS = 60_000;
export const STALE_CLAIM_MS = 120_000;
const MAX_ATTEMPTS = 5;
const TX = { timeout: 10_000 };
const OUTCOMES: SendOutcome[] = [
  "SENT",
  "RETRY",
  "UNCERTAIN",
  "FAILED",
  "AUTH",
  "STALE",
  "RELEASED",
  "CANCELLED",
  "LOST",
];

const ymd = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";
/** The reservation a row holds now, on its stored days (a re-claim stores new ones). */
const refOf = (m: {
  accountId: string;
  campaignId: string;
  workspaceId: string;
  usageDay: Date | null;
  campUsageDay: Date | null;
  wsUsageDay: Date | null;
  reservedUnits: number;
}): UsageRef => ({
  accountId: m.accountId,
  campaignId: m.campaignId,
  workspaceId: m.workspaceId,
  usageDay: ymd(m.usageDay),
  campUsageDay: ymd(m.campUsageDay),
  wsUsageDay: ymd(m.wsUsageDay),
  reservedUnits: m.reservedUnits,
});

const lockLead = (tx: Tx, campaignLeadId: string) =>
  tx.$queryRaw`SELECT 1 FROM "CampaignLead" WHERE id = ${campaignLeadId} FOR NO KEY UPDATE`;
const OPEN = ["QUEUED", "ACTIVE", "PAUSED"] as const;
const pauseLead = (tx: Tx, id: string) =>
  tx.campaignLead.updateMany({
    where: { id, state: { in: ["QUEUED", "ACTIVE"] } },
    data: { state: "PAUSED", stopReason: "SEND_FAILED" },
  });

/**
 * Leaves SENDING for `data` in one short transaction, conditional on our claim (id + claimToken + SENDING). Lock order
 * (D21): the row, then the CampaignLead, then `lead` (CampaignLead/Lead/Suppression writes), then the usage release,
 * then `account` (EmailAccount). False when the row is no longer ours: nothing is written.
 */
async function settle(
  db: PrismaClient,
  c: Claimed,
  data: Prisma.ScheduledMessageUpdateManyMutationInput,
  o: {
    release: boolean;
    lead?: (tx: Tx) => Promise<unknown>;
    account?: (tx: Tx) => Promise<unknown>;
  },
): Promise<boolean> {
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const r = await tx.scheduledMessage.updateMany({
        where: { id: c.id, claimToken: c.claimToken, status: "SENDING" },
        data,
      });
      if (!r.count) return false;
      if (o.lead) {
        await lockLead(tx, c.campaignLeadId);
        await o.lead(tx);
      }
      if (o.release) await releaseUsage(tx, c);
      await o.account?.(tx);
      return true;
    }, TX),
  );
}

/** One claimed row: stale check, pre-call re-check, send outside any transaction, then record the result. */
export async function sendClaimed(
  db: PrismaClient,
  clock: Clock,
  deps: SenderDeps,
  c: Claimed,
): Promise<SendOutcome> {
  if (clock.now().getTime() - c.claimedAt.getTime() > STALE_CLAIM_MS)
    return (await settle(db, c, { status: "SCHEDULED" }, { release: true })) ? "STALE" : "LOST";
  const pre = await precheck(db, clock, deps, c);
  if (typeof pre === "string") return pre;
  let res: SendResult;
  try {
    let provider: MailProvider;
    try {
      provider = deps.providerFor(pre.account);
    } catch {
      throw new TransientBeforeSendError("provider_unavailable"); // nothing was sent
    }
    res = await provider.send(pre.mime, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  } catch (e) {
    return failed(db, clock, deps, c, pre.leadEmail, e);
  }
  return recordAccepted(db, clock, c, res);
}

/** Review Focus 2 / I1 / M1: everything that may have changed since the claim, read once right before the provider call. */
async function precheck(
  db: PrismaClient,
  clock: Clock,
  deps: SenderDeps,
  c: Claimed,
): Promise<SendOutcome | { account: EmailAccount; mime: OutboundMime; leadEmail: string }> {
  const now = clock.now();
  const m = await db.scheduledMessage.findUnique({ where: { id: c.id } });
  // whoever changed the token (late accept, recovery) owns the reservation now: never release it from here
  if (!m || m.status !== "SENDING" || m.claimToken !== c.claimToken) return "LOST";
  const cl = await db.campaignLead.findUniqueOrThrow({ where: { id: m.campaignLeadId } });
  const lead = await db.lead.findUniqueOrThrow({ where: { id: cl.leadId } });
  const step = await db.sequenceStep.findUniqueOrThrow({ where: { id: m.stepId } });
  const camp = await db.campaign.findUniqueOrThrow({ where: { id: m.campaignId } });
  const a = await db.emailAccount.findUniqueOrThrow({ where: { id: m.accountId } });
  const w = await db.workspace.findUniqueOrThrow({ where: { id: m.workspaceId } });
  const assigned = await db.campaignAccount.count({
    where: { campaignId: camp.id, accountId: a.id },
  });
  const schedules = await db.campaignSchedule.findMany({ where: { campaignId: camp.id } });
  const cancel = (error: string, lead?: (tx: Tx) => Promise<unknown>) =>
    settle(db, c, { status: "CANCELLED", error }, { release: true, lead }).then((ok) =>
      ok ? ("CANCELLED" as const) : ("LOST" as const),
    );
  const back = (data: Prisma.ScheduledMessageUpdateManyMutationInput = {}) =>
    settle(db, c, { status: "SCHEDULED", ...data }, { release: true }).then((ok) =>
      ok ? ("RELEASED" as const) : ("LOST" as const),
    );

  if (lead.deletedAt || (await isSuppressed(db, m.workspaceId, lead.email)))
    return cancel("suppressed", (tx) =>
      tx.campaignLead.updateMany({
        where: { id: cl.id, state: { in: ["QUEUED", "ACTIVE"] } },
        data: { state: "STOPPED", stopReason: "SUPPRESSED", nextDueAt: null, completedAt: now },
      }),
    );
  // will never resume (I1): the planner re-plans whatever is still the lead's current step
  if (
    cl.state === "STOPPED" ||
    cl.state === "COMPLETED" ||
    cl.currentStepId !== m.stepId ||
    step.deletedAt ||
    camp.deletedAt ||
    camp.status === "ARCHIVED" ||
    camp.status === "COMPLETED"
  )
    return cancel("stale");
  // can resume: the row waits, SCHEDULED, for whatever is paused to come back
  if (
    camp.status !== "ACTIVE" ||
    cl.state === "PAUSED" ||
    a.deletedAt ||
    !["ACTIVE", "REWARMING"].includes(a.lifecycle) ||
    !assigned ||
    !w.physicalAddress?.trim()
  )
    return back();
  const windows: Window[] = schedules.map(({ timezone, days, from, to }) => ({
    timezone,
    days,
    from,
    to,
  }));
  if (!isInWindow(windows, now) || (camp.endAt && camp.endAt <= now)) {
    let dueAt: Date;
    try {
      dueAt = nextWindowStart(windows, now);
    } catch {
      dueAt = new Date(now.getTime() + 3600_000); // no day bit set: the planner and explainer report it
    }
    return back({ dueAt });
  }

  const earlier = await db.scheduledMessage.findMany({
    where: { campaignLeadId: cl.id, status: "SENT", id: { not: m.id } },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    select: { rfcMessageId: true },
  });
  const refs = earlier.flatMap((x) => (x.rfcMessageId ? [x.rfcMessageId] : []));
  let mime: OutboundMime;
  try {
    mime = {
      from: { email: a.email, name: a.fromName },
      to: [{ email: lead.email }],
      cc: m.cc.map((email) => ({ email })),
      bcc: m.bcc.map((email) => ({ email })),
      ...(a.replyTo ? { replyTo: { email: a.replyTo } } : {}),
      subject: m.renderedSubject,
      // text-only rows store the text as the body (planner `stored`)
      ...(m.renderedBody === m.renderedText ? {} : { html: m.renderedBody }),
      text: m.renderedText,
      messageId: c.rfcMessageId,
      ...(refs.length ? { inReplyTo: refs.at(-1), references: refs } : {}),
      ...(cl.threadRef ? { threadId: cl.threadRef } : {}),
      // rebuilt from current state on every send, never stored
      headers: listUnsubscribeHeaders(
        deps.env,
        { w: m.workspaceId, l: lead.id, c: camp.id },
        a.email,
      ),
    };
    await buildMime(mime); // I11: a CR/LF in any header fails here, before any provider call
  } catch {
    const ok = await settle(
      db,
      c,
      { status: "FAILED", error: "mime_invalid" },
      { release: true, lead: (tx) => pauseLead(tx, cl.id) },
    );
    return ok ? "FAILED" : "LOST";
  }
  return { account: a, mime, leadEmail: lead.email };
}

/** The error table (brief steps 5-10). Every write is conditional on our claim; the Graph draft id is kept as a hint. */
async function failed(
  db: PrismaClient,
  clock: Clock,
  deps: SenderDeps,
  c: Claimed,
  leadEmail: string,
  e: unknown,
): Promise<SendOutcome> {
  const now = clock.now();
  const hint = e instanceof ProviderError && e.providerMessageId;
  const keep = hint ? { providerMessageId: hint } : {};
  const done = (ok: boolean, out: SendOutcome) => (ok ? out : "LOST");

  if (e instanceof RateLimitedError || e instanceof TransientBeforeSendError) {
    const attempts =
      (await db.scheduledMessage.findUniqueOrThrow({ where: { id: c.id } })).attempts + 1;
    const push =
      e instanceof RateLimitedError
        ? (tx: Tx) => tx.$executeRaw`UPDATE "EmailAccount"
            SET "nextSendAt" = GREATEST("nextSendAt", ${new Date(now.getTime() + e.retryAfterSec * 1000)})
            WHERE id = ${c.accountId}`
        : undefined;
    if (attempts >= MAX_ATTEMPTS)
      return done(
        await settle(
          db,
          c,
          { status: "FAILED", error: "max_attempts", attempts, ...keep },
          { release: true, lead: (tx) => pauseLead(tx, c.campaignLeadId), account: push },
        ),
        "FAILED",
      );
    const backoff = Math.max(
      e instanceof RateLimitedError ? e.retryAfterSec : 0,
      60 * 2 ** (attempts - 1),
    );
    const jitter = Math.floor((deps.random ?? Math.random)() * 30);
    return done(
      await settle(
        db,
        c,
        {
          status: "SCHEDULED",
          attempts,
          dueAt: new Date(now.getTime() + (backoff + jitter) * 1000),
          error: e.message,
          ...keep,
        },
        { release: true, account: push },
      ),
      "RETRY",
    );
  }
  if (e instanceof AuthError)
    return done(
      await settle(
        db,
        c,
        { status: "SCHEDULED", error: e.message, ...keep },
        { release: true, account: (tx) => recordProviderError(tx, clock, c.accountId, e) },
      ),
      "AUTH",
    );
  if (e instanceof PermanentSendError) {
    if (e.scope === "account")
      return done(
        await settle(
          db,
          c,
          { status: "SCHEDULED", error: e.code, ...keep },
          { release: true, account: (tx) => recordProviderError(tx, clock, c.accountId, e) },
        ),
        "RELEASED",
      );
    if (e.scope === "recipient")
      return done(
        await settle(
          db,
          c,
          { status: "FAILED", error: e.code, ...keep },
          {
            release: true,
            lead: async (tx) => {
              // BOUNCED first: suppress() stamps SUPPRESSED on whatever is still open
              await tx.campaignLead.updateMany({
                where: { id: c.campaignLeadId, state: { in: [...OPEN] } },
                data: {
                  state: "STOPPED",
                  stopReason: "BOUNCED",
                  nextDueAt: null,
                  completedAt: now,
                },
              });
              await suppress(
                tx,
                c.workspaceId,
                [{ kind: "EMAIL", value: leadEmail }],
                "HARD_BOUNCE",
                "send",
              );
            },
          },
        ),
        "FAILED",
      );
    return done(
      await settle(
        db,
        c,
        { status: "FAILED", error: e.code, ...keep },
        {
          release: true,
          lead: (tx) => pauseLead(tx, c.campaignLeadId),
          account: (tx) => recordProviderError(tx, clock, c.accountId, e),
        },
      ),
      "FAILED",
    );
  }
  // Ambiguous, or anything unclassified: it may have gone out. Kept reserved, never retried here (D5).
  return done(
    await settle(
      db,
      c,
      {
        status: "UNCERTAIN",
        uncertainAt: now,
        error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
        ...keep,
      },
      { release: false },
    ),
    "UNCERTAIN",
  );
}

/**
 * The provider accepted `c`. Records SENT conditionally on our claim; when the row moved on meanwhile, applies the
 * late-accept table instead. Idempotent: a repeat finds the row SENT with our token and changes nothing. Never sends.
 */
export async function recordAccepted(
  db: PrismaClient,
  clock: Clock,
  c: Claimed,
  res: SendResult,
): Promise<SendOutcome> {
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const now = clock.now();
      const data = {
        status: "SENT" as const,
        sentAt: now,
        claimToken: c.claimToken,
        providerMessageId: res.providerMessageId ?? null,
        providerThreadId: res.providerThreadId ?? null,
        error: null,
      };
      const r = await tx.scheduledMessage.updateMany({
        where: { id: c.id, claimToken: c.claimToken, status: "SENDING" },
        data,
      });
      if (r.count) {
        await recordSent(tx, clock, c, res, now, (t) => commitUsage(t, c));
        return "SENT";
      }
      const [m] = await tx.$queryRaw<
        {
          status: string;
          claimToken: string | null;
          accountId: string;
          campaignId: string;
          workspaceId: string;
          usageDay: Date | null;
          campUsageDay: Date | null;
          wsUsageDay: Date | null;
          reservedUnits: number;
        }[]
      >`SELECT status::text, "claimToken", "accountId", "campaignId", "workspaceId", "usageDay", "campUsageDay",
          "wsUsageDay", "reservedUnits" FROM "ScheduledMessage" WHERE id = ${c.id} FOR UPDATE`;
      if (!m) return "LOST"; // the lead was hard-deleted meanwhile
      if (m.status === "SENT") {
        // I8: another claim of the same row also went out; both messages count
        if (m.claimToken !== c.claimToken) await creditSent(tx, c);
        return "SENT";
      }
      const usage =
        m.status === "UNCERTAIN" || m.status === "SENDING"
          ? (t: Tx) => commitUsage(t, refOf(m)) // still reserved: ours, or the re-claim's on its stored days
          : (t: Tx) => creditSent(t, c); // HELD, CANCELLED, SCHEDULED, FAILED: already released
      await tx.scheduledMessage.update({ where: { id: c.id }, data });
      await recordSent(tx, clock, c, res, now, usage);
      return "SENT";
    }, TX),
  );
}

/** Side effects of a SENT row, in lock order after the row: CampaignLead, usage, EmailAccount, Lead, then advance. */
async function recordSent(
  tx: Tx,
  clock: Clock,
  c: Claimed,
  res: SendResult,
  now: Date,
  usage: (tx: Tx) => Promise<void>,
) {
  await lockLead(tx, c.campaignLeadId);
  await usage(tx);
  await tx.emailAccount.update({
    where: { id: c.accountId },
    data: { lastSentAt: now, lastCampaignActivityAt: now, consecutivePermanentErrors: 0 },
  });
  const cl = await tx.campaignLead.findUniqueOrThrow({ where: { id: c.campaignLeadId } });
  await tx.lead.update({
    where: { id: cl.leadId },
    data: {
      emailsSent: { increment: 1 },
      lastContactedAt: now,
      lastTouchAt: now,
      lastSenderAccountId: c.accountId,
    },
  });
  // sticky sender and thread: the lead's first SENT email decides both
  if (!cl.accountId || (!cl.threadRef && res.providerThreadId))
    await tx.campaignLead.update({
      where: { id: cl.id },
      data: {
        accountId: cl.accountId ?? c.accountId,
        threadRef: cl.threadRef ?? res.providerThreadId ?? null,
      },
    });
  await advanceLead(tx, clock, { campaignLeadId: c.campaignLeadId, stepId: c.stepId, sentAt: now });
}

/**
 * One dispatcher tick: claim up to `concurrency` rows, send them in parallel, repeat until nothing is claimable or
 * `maxMs` (wall time) has passed. A throw from one send is logged and leaves that row SENDING for recovery (I5).
 */
export async function dispatchTick(
  db: PrismaClient,
  clock: Clock,
  deps: SenderDeps & Omit<ClaimOpts, "limit"> & { maxMs?: number; concurrency?: number },
): Promise<Record<SendOutcome, number>> {
  const out = Object.fromEntries(OUTCOMES.map((k) => [k, 0])) as Record<SendOutcome, number>;
  const start = Date.now();
  while (Date.now() - start < (deps.maxMs ?? 50_000)) {
    const batch = await claimDue(db, clock, { ...deps, limit: deps.concurrency ?? 4 });
    if (!batch.length) break;
    await Promise.all(
      batch.map(async (c) => {
        try {
          out[await sendClaimed(db, clock, deps, c)] += 1;
        } catch (e) {
          console.error(`dispatchTick: row ${c.id} left SENDING for recovery`, e);
        }
      }),
    );
  }
  return out;
}
