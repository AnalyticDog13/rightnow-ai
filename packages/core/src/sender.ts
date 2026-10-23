import { Prisma, type EmailAccount, type PrismaClient } from "@rightnow/db/client";
import {
  AuthError,
  PermanentSendError,
  ProviderError,
  RateLimitedError,
  TransientBeforeSendError,
  buildMime,
  type MailProvider,
  type PermanentScope,
  type OutboundMime,
  type SendResult,
} from "@rightnow/providers";
import { recordProviderError } from "./accounts/health";
import { stopLead } from "./campaigns/hooks";
import type { Clock } from "./clock";
import { claimDue, withTxRetry, type ClaimOpts, type Claimed } from "./dispatch";
import { isSuppressed, suppress } from "./leads/suppression";
import { advanceLead } from "./planner";
import { commitUsage, creditSent, releaseUsage, type UsageRef } from "./quota";
import { isInWindow, nextWindowStart, type Window } from "./schedule";
import { listUnsubscribeHeaders, unsubscribeUrl, type RenderEnv } from "./unsubscribe";
import { trackingBase, withTracking } from "./mail/tracking";
import { OPEN_STATES } from "./campaigns/lead-status";
import { recordEvent } from "./mail/events";
import { recordOutboundMessage } from "./mail/ingest";

type Tx = Prisma.TransactionClient;

export type SendOutcome =
  "SENT" | "RETRY" | "UNCERTAIN" | "FAILED" | "AUTH" | "STALE" | "RELEASED" | "CANCELLED" | "LOST";
export type SenderDeps = {
  providerFor: (a: EmailAccount) => MailProvider;
  /** `trackingKeys` (HKDF of ENCRYPTION_KEY): without them nothing is tracked. */
  env: RenderEnv & { trackingKeys?: Buffer[] };
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
export const refOf = (m: {
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
const pauseLead = (tx: Tx, id: string) =>
  tx.campaignLead.updateMany({
    where: { id, state: { in: ["QUEUED", "ACTIVE"] } },
    data: { state: "PAUSED", stopReason: "SEND_FAILED" },
  });

/** ACCEPTED / SEND_FAILED event of a row (a leaf table: written last in the transaction). */
async function sendEvent(
  tx: Tx,
  type: "ACCEPTED" | "SEND_FAILED",
  c: Claimed,
  at: Date,
  meta: Prisma.InputJsonObject = {},
) {
  const m = await tx.scheduledMessage.findUniqueOrThrow({
    where: { id: c.id },
    select: { variantId: true, campaignLead: { select: { leadId: true } } },
  });
  await recordEvent(tx, {
    workspaceId: c.workspaceId,
    type,
    occurredAt: at,
    leadId: m.campaignLead.leadId,
    campaignId: c.campaignId,
    accountId: c.accountId,
    stepId: c.stepId,
    variantId: m.variantId,
    scheduledMessageId: c.id,
    meta,
    dedupeKey: `${type === "ACCEPTED" ? "acc" : "fail"}:${c.id}`,
  });
}

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
    /** Instead of releasing: the reservation becomes sent (N-1, a Cc/Bcc copy left the account). */
    commit?: boolean;
    lead?: (tx: Tx) => Promise<unknown>;
    account?: (tx: Tx) => Promise<unknown>;
    /** A FAILED settle's SEND_FAILED event: its time and, for a provider failure, its D18 scope (D34 health). */
    failed?: { at: Date; scope?: PermanentScope };
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
      else if (o.commit) await commitUsage(tx, c);
      await o.account?.(tx);
      if (o.failed)
        await sendEvent(tx, "SEND_FAILED", c, o.failed.at, {
          error: String(data.error ?? ""),
          ...(o.failed.scope && { scope: o.failed.scope }),
        });
      return true;
    }, TX),
  );
}

/** One claimed row: pre-call re-check, stale check, send outside any transaction, then record the result. */
export async function sendClaimed(
  db: PrismaClient,
  clock: Clock,
  deps: SenderDeps,
  c: Claimed,
): Promise<SendOutcome> {
  const pre = await precheck(db, clock, deps, c);
  if (typeof pre === "string") return pre;
  // after the pre-call check (gate M-2): a sleep during it must not send on hours-old window/suppression reads
  if (clock.now().getTime() - c.claimedAt.getTime() > STALE_CLAIM_MS)
    return (await settle(db, c, { status: "SCHEDULED" }, { release: true })) ? "STALE" : "LOST";
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
    return failed(db, clock, deps, c, pre, e);
  }
  return recordAccepted(db, clock, c, res);
}

/** Review Focus 2 / I1 / M1: everything that may have changed since the claim, read once right before the provider call. */
async function precheck(
  db: PrismaClient,
  clock: Clock,
  deps: SenderDeps,
  c: Claimed,
): Promise<
  SendOutcome | { account: EmailAccount; mime: OutboundMime; leadEmail: string; copied: boolean }
> {
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
    return cancel("suppressed", (tx) => stopLead(tx, cl.id, "SUPPRESSED", now));
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
    const unsub = { w: m.workspaceId, l: lead.id, c: camp.id };
    // tracking is added per send, the stored body stays untracked (D28); text-only rows have no html to track
    const base = trackingBase(a, deps.env.appUrl);
    const first = step.order === 1 && !step.subsequenceId;
    const opens = camp.trackOpens && !w.disableOpenTracking;
    const clicks = camp.trackClicks;
    const hasHtml = m.renderedBody !== m.renderedText;
    const track =
      hasHtml &&
      base &&
      deps.env.trackingKeys?.[0] &&
      !camp.textOnly &&
      !(first && camp.firstEmailTextOnly) &&
      (opens || clicks);
    const html = !hasHtml
      ? undefined
      : track
        ? withTracking(m.renderedBody, {
            base,
            scheduledMessageId: m.id,
            opens,
            clicks,
            key: deps.env.trackingKeys![0]!,
            skipUrls: [unsubscribeUrl(deps.env, unsub, a.email)],
          })
        : m.renderedBody;
    mime = {
      from: { email: a.email, name: a.fromName },
      to: [{ email: lead.email }],
      cc: m.cc.map((email) => ({ email })),
      bcc: m.bcc.map((email) => ({ email })),
      ...(a.replyTo ? { replyTo: { email: a.replyTo } } : {}),
      subject: m.renderedSubject,
      // text-only rows store the text as the body (planner `stored`)
      ...(html === undefined ? {} : { html }),
      text: m.renderedText,
      messageId: c.rfcMessageId,
      ...(refs.length ? { inReplyTo: refs.at(-1), references: refs } : {}),
      ...(cl.threadRef ? { threadId: cl.threadRef } : {}),
      // rebuilt from current state on every send, never stored
      headers: listUnsubscribeHeaders(deps.env, unsub, a.email),
    };
    await buildMime(mime); // I11: a CR/LF in any header fails here, before any provider call
  } catch {
    const ok = await settle(
      db,
      c,
      { status: "FAILED", error: "mime_invalid" },
      // our own data is at fault, not the provider: no scope, so it never counts against the account's health
      { release: true, lead: (tx) => pauseLead(tx, cl.id), failed: { at: now } },
    );
    return ok ? "FAILED" : "LOST";
  }
  return { account: a, mime, leadEmail: lead.email, copied: m.cc.length + m.bcc.length > 0 };
}

/** The error table (brief steps 5-10). Every write is conditional on our claim; the Graph draft id is kept as a hint. */
async function failed(
  db: PrismaClient,
  clock: Clock,
  deps: SenderDeps,
  c: Claimed,
  pre: { account: EmailAccount; leadEmail: string; copied: boolean },
  e: unknown,
): Promise<SendOutcome> {
  // P3-T11a: Gmail and Graph refuse the whole message without saying which address failed, so with Cc/Bcc a
  // "recipient" rejection may be about a copy: treat it as unknown scope (lead paused, nobody suppressed, no strike)
  if (
    e instanceof PermanentSendError &&
    e.scope === "recipient" &&
    pre.copied &&
    pre.account.provider !== "SMTP"
  ) {
    const unknown = new PermanentSendError(e.code, e.detail, {
      scope: "unknown",
      countsTowardPause: false,
    });
    unknown.providerMessageId = e.providerMessageId;
    return failed(db, clock, deps, c, pre, unknown);
  }
  const now = clock.now();
  const leadEmail = pre.leadEmail;
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
          {
            release: true,
            lead: (tx) => pauseLead(tx, c.campaignLeadId),
            account: push,
            failed: { at: now, scope: "unknown" },
          },
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
    // N-1: the lead was refused but a Cc/Bcc copy went out, so the usage stays counted
    const partial = e.code === "lead_rejected_partial";
    const usage = { release: !partial, commit: partial };
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
            ...usage,
            failed: { at: now, scope: "recipient" },
            lead: async (tx) => {
              // BOUNCED first: suppress() stamps SUPPRESSED on whatever is still open
              await tx.campaignLead.updateMany({
                where: { id: c.campaignLeadId, state: { in: [...OPEN_STATES] } },
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
          ...usage,
          lead: (tx) => pauseLead(tx, c.campaignLeadId),
          account: (tx) => recordProviderError(tx, clock, c.accountId, e),
          failed: { at: now, scope: e.scope },
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
 * `sentAt` (resolveUncertain: the date of the copy found in Sent) defaults to now.
 */
export async function recordAccepted(
  db: PrismaClient,
  clock: Clock,
  c: Claimed,
  res: SendResult,
  sentAt?: Date,
): Promise<SendOutcome> {
  const res2 = await withTxRetry(() =>
    db.$transaction((tx) => acceptTx(tx, clock, c, res, sentAt), TX),
  );
  if (res2 === "SENT") await recordOutboundMessage(db, c.id); // after every accepted result; idempotent, never throws
  return res2;
}

/** recordAccepted's transaction body, for a caller that already holds one (M17: a reply proves an UNCERTAIN/HELD row went out). */
export async function acceptTx(
  tx: Tx,
  clock: Clock,
  c: Claimed,
  res: SendResult,
  sentAt?: Date,
): Promise<"SENT" | "LOST"> {
  const now = sentAt ?? clock.now();
  const data = {
    status: "SENT" as const,
    sentAt: now,
    claimToken: c.claimToken || null, // "": a recovered or HELD row without a token
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
  // D32: the re-warm ramp counts local days with a send (the claim's usage day); held while health-capped
  await tx.$executeRaw`UPDATE "EmailAccount" SET "rewarmSendDays" = "rewarmSendDays" + 1,
      "rewarmLastSendDay" = ${c.usageDay}::date
    WHERE id = ${c.accountId} AND "rewarmStartedAt" IS NOT NULL AND "healthCap" IS NULL
      AND "rewarmLastSendDay" IS DISTINCT FROM ${c.usageDay}::date`;
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
  await sendEvent(tx, "ACCEPTED", c, now);
}

/**
 * One dispatcher tick: claim up to `concurrency` rows, send them in parallel, repeat until nothing is claimable,
 * `maxMs` (wall time) has passed or `signal` fired (worker stopping: the batch in flight finishes, nothing new is
 * claimed). A throw from one send is logged and leaves that row SENDING for recovery (I5).
 */
export async function dispatchTick(
  db: PrismaClient,
  clock: Clock,
  deps: SenderDeps &
    Omit<ClaimOpts, "limit"> & { maxMs?: number; concurrency?: number; signal?: AbortSignal },
): Promise<Record<SendOutcome, number>> {
  const out = Object.fromEntries(OUTCOMES.map((k) => [k, 0])) as Record<SendOutcome, number>;
  const start = Date.now();
  while (!deps.signal?.aborted && Date.now() - start < (deps.maxMs ?? 50_000)) {
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
