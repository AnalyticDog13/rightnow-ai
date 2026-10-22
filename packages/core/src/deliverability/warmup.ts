import { randomBytes } from "node:crypto";
import {
  Prisma,
  type AccountProvider,
  type EmailAccount,
  type PrismaClient,
  type WarmupMessage,
  type WarmupSettings,
} from "@rightnow/db/client";
import {
  AmbiguousSendError,
  AuthError,
  mapLimit,
  newMessageId,
  type RemoteMessage,
} from "@rightnow/providers";
import { dayKey } from "../accounts/daykey";
import { recordProviderError } from "../accounts/health";
import type { Clock } from "../clock";
import { sendableProviders } from "../dispatch";
import { getEnv, type Env } from "../env";
import type { Classification } from "../mail/classify";
import { codeOf } from "../mail/ingest";
import type { SyncDeps } from "../mail/sync";
import { WARMUP_DEFAULTS } from "./warmup-settings";
import { isInWindow, localMidnightUtc, nextWindowStart, type Window } from "../schedule";

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

/** External services plug in here (D36); there is no built-in external adapter. */
export interface WarmupProvider {
  readonly name: string;
  enable(accountId: string): Promise<void>;
  disable(accountId: string): Promise<void>;
  stats(accountId: string, from: Date, to: Date): Promise<WarmupDay[]>;
}
export type WarmupDay = {
  day: string;
  sent: number;
  received: number;
  replied: number;
  inbox: number;
  spam: number;
  missing: number;
};

const MIN = 60_000;
const DAY = 86_400_000;
const MIN_GAP_MS = 600_000;
const REPLY_DELAY_MS = 30 * MIN;
const ABANDON_MS = 10 * MIN;
const LOCATE_AFTER_MS = 60 * MIN;
/** Warm-up says what it is (D36): one fixed text, no spinning or randomising to evade filters. */
const BODY =
  "Automated warm-up message between two mailboxes of the same sender, sent by a self-hosted rightnow-ai installation. No action is needed.";
const HEADERS = { "X-RightNow-Warmup": "1", "Auto-Submitted": "auto-generated" };
const FROM_HOUR = 8;
const TO_HOUR = 20;

const window = (timezone: string, weekdaysOnly: boolean): Window => ({
  timezone,
  days: weekdaysOnly ? 0b0111110 : 0b1111111,
  from: `${String(FROM_HOUR).padStart(2, "0")}:00`,
  to: `${TO_HOUR}:00`,
});
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
const curveOf = (s: Pick<WarmupSettings, "customCurve">) =>
  Array.isArray(s.customCurve) ? (s.customCurve as { day: number; volume: number }[]) : [];

/** Messages one mailbox warms up with today: warm-up plus campaign mail stays within 60 % of the provider cap (D36). */
export function warmupTarget(
  s: Pick<
    WarmupSettings,
    | "dailyLimit"
    | "slowWarmup"
    | "startVolume"
    | "increasePerDay"
    | "customCurve"
    | "weekdaysOnly"
    | "startedAt"
  >,
  a: Pick<EmailAccount, "providerCap" | "timezone">,
  now: Date,
): number {
  const today = dayKey(a.timezone, now);
  if (s.weekdaysOnly && [0, 6].includes(dow(today))) return 0;
  const idx = s.startedAt
    ? Math.max(
        0,
        Math.round((Date.parse(today) - Date.parse(dayKey(a.timezone, s.startedAt))) / DAY),
      )
    : 0;
  const curve = curveOf(s);
  const v = curve.length
    ? (curve.findLast((e) => e.day <= idx)?.volume ?? 0)
    : s.slowWarmup
      ? Math.min(s.dailyLimit, s.startVolume + s.increasePerDay * idx)
      : s.dailyLimit;
  return Math.max(0, Math.min(v, 50, Math.floor(a.providerCap / 10)));
}

export type WarmupState =
  "PAUSED" | "ACTIVE" | "PROVIDER_BLOCKED" | "PLACEMENT_UNKNOWN" | "SUSPENDED"; // PS-WARM-10

/** `peers` = other opted-in, usable mailboxes of the workspace. `sendable` = D17 providers (omitted: not checked). */
export function warmupState(
  a: Pick<EmailAccount, "provider" | "status" | "lifecycle" | "deletedAt">,
  s: Pick<WarmupSettings, "enabled"> | null,
  peers: number,
  sendable?: AccountProvider[],
): WarmupState {
  if (a.deletedAt || a.status === "DISCONNECTED") return "SUSPENDED";
  if (!s?.enabled || a.lifecycle === "PAUSED") return "PAUSED";
  if (a.status === "ERROR" || a.lifecycle === "NEEDS_ATTENTION") return "PROVIDER_BLOCKED";
  if (sendable && !sendable.includes(a.provider)) return "PROVIDER_BLOCKED"; // not live-verified (Rev 2 I7)
  return peers < 1 ? "PLACEMENT_UNKNOWN" : "ACTIVE";
}

/** Opted-in mailboxes that may send or receive warm-up mail now. */
const usable = (
  sendable: AccountProvider[],
  workspaceId?: string,
): Prisma.WarmupSettingsWhereInput => ({
  enabled: true,
  ...(workspaceId && { workspaceId }),
  account: {
    deletedAt: null,
    status: "CONNECTED",
    lifecycle: { notIn: ["PAUSED", "NEEDS_ATTENTION"] },
    provider: { in: sendable },
    credentialsEnc: { not: null },
  },
});

/**
 * Sync hook (Rev 2 I1): true when the message is warm-up or placement traffic of this mailbox, so the caller stores
 * nothing. Matched by Message-ID, In-Reply-To, any References id, or a DSN/ARF's original Message-ID: no header is
 * trusted, so an outsider cannot hide mail by adding one. The first receipt of a SEND may plan a reply (D36).
 */
export async function warmupReceipt(
  tx: Tx,
  clock: Clock,
  acct: Pick<EmailAccount, "id" | "workspaceId">,
  m: Pick<RemoteMessage, "rfcMessageId" | "inReplyTo" | "references" | "folder">,
  c: Classification,
  random: () => number = Math.random,
): Promise<boolean> {
  const orig = c.kind === "BOUNCE" || c.kind === "COMPLAINT" ? c.originalMessageId : null;
  const ids = [...new Set([m.rfcMessageId, m.inReplyTo, ...m.references, orig])].filter(
    (x): x is string => !!x,
  );
  if (!ids.length) return false;
  const hits = await tx.warmupMessage.findMany({
    where: {
      workspaceId: acct.workspaceId,
      rfcMessageId: { in: ids },
      OR: [{ fromAccountId: acct.id }, { toAccountId: acct.id }],
    },
  });
  if (!hits.length) return false;
  const own = hits.find((h) => h.rfcMessageId === m.rfcMessageId);
  if (!own) {
    const bounced = hits.find((h) => h.rfcMessageId === orig);
    if (bounced && (c.kind === "BOUNCE" || c.kind === "COMPLAINT"))
      await tx.warmupMessage.updateMany({
        where: { id: bounced.id, error: null },
        data: { error: c.kind === "BOUNCE" ? "bounced" : "complaint" },
      });
    return true; // an auto-reply or any answer to a warm-up message is dropped
  }
  if (own.toAccountId !== acct.id || m.folder !== "INBOX") return true; // our own Sent copy
  const now = clock.now();
  const first = await tx.warmupMessage.updateMany({
    where: { id: own.id, receivedAt: null },
    data: { receivedAt: now, landedFolder: "INBOX" },
  });
  if (!first.count || own.kind !== "SEND") return true; // never a reply to a reply or a placement message
  const s = await tx.warmupSettings.findUnique({ where: { accountId: acct.id } });
  const a = await tx.emailAccount.findUnique({
    where: { id: acct.id },
    select: { email: true, timezone: true },
  });
  if (!s?.enabled || !a || !(random() < s.replyRatePct / 100)) return true;
  await tx.warmupMessage.create({
    data: {
      workspaceId: acct.workspaceId,
      fromAccountId: acct.id,
      toAccountId: own.fromAccountId,
      kind: "REPLY",
      status: "PLANNED",
      rfcMessageId: newMessageId(domainOf(a.email)),
      subject: `Re: ${own.subject}`,
      parentId: own.id,
      // not before its window: the replier's own hours and weekdays (Rev 2 M11)
      dueAt: nextWindowStart(
        [window(a.timezone, s.weekdaysOnly)],
        new Date(now.getTime() + REPLY_DELAY_MS),
      ),
    },
  });
  return true;
}

type Live = WarmupSettings & { account: EmailAccount };

/**
 * One warm-up pass (D36), every 5 minutes. Never catches up: a missed slot is gone, the day's target does not grow.
 * Nothing here opens, marks, moves or deletes mail: the only mailbox writes are the sends themselves.
 */
export async function warmupTick(
  prisma: PrismaClient,
  clock: Clock,
  deps: {
    providerFor: SyncDeps["providerFor"];
    random?: () => number; // the plan's slot; the reply draw is made on receipt, see SyncDeps.random
    env?: Pick<Env, "MAIL_PROVIDER_FAKE">; // tests: the D17 gate without a ProviderVerification row
    signal?: AbortSignal;
  },
): Promise<{ sent: number; replied: number; located: number }> {
  const out = { sent: 0, replied: 0, located: 0 };
  const now = clock.now();
  const sendable = await sendableProviders(prisma, deps.env ?? getEnv());
  const ago = (ms: number) => new Date(now.getTime() - ms);

  // (1) crashed mid-send: never resent. A PLANNED reply may wait (target, spacing, weekend): it only expires after a day
  await prisma.warmupMessage.updateMany({
    where: { status: "SENDING", sentAt: { lt: ago(ABANDON_MS) } },
    data: { status: "FAILED", error: "abandoned" },
  });
  await prisma.warmupMessage.updateMany({
    where: { status: "PLANNED", dueAt: { lt: ago(DAY) } },
    data: { status: "FAILED", error: "expired" },
  });

  const live: Live[] = await prisma.warmupSettings.findMany({
    where: usable(sendable),
    include: { account: true },
    orderBy: { accountId: "asc" },
  });
  const byId = new Map(live.map((s) => [s.accountId, s]));

  const send = async (
    from: EmailAccount,
    to: string,
    row: WarmupMessage,
    parent?: WarmupMessage,
  ) => {
    try {
      await (
        await deps.providerFor(from)
      ).send(
        {
          from: { email: from.email, name: from.fromName },
          to: [{ email: to }],
          subject: row.subject,
          text: BODY,
          messageId: row.rfcMessageId,
          ...(parent && { inReplyTo: parent.rfcMessageId, references: [parent.rfcMessageId] }),
          headers: HEADERS,
        },
        { signal: deps.signal },
      );
    } catch (e) {
      // may have gone out: keep it SENT (counts today, receipt and locate still match it), never resent
      const maybeSent = e instanceof AmbiguousSendError;
      if (!maybeSent) {
        await prisma.warmupMessage.updateMany({
          where: { id: row.id, status: "SENDING" },
          data: { status: "FAILED", error: codeOf(e) },
        });
        if (e instanceof AuthError) await recordProviderError(prisma, clock, from.id, e);
        return false;
      }
      await prisma.warmupMessage.updateMany({
        where: { id: row.id, status: "SENDING" },
        data: { status: "SENT", sentAt: clock.now(), error: "ambiguous_send" },
      });
      await prisma.emailAccount.updateMany({
        where: { id: from.id },
        data: { lastWarmupAt: clock.now() },
      });
      return true;
    }
    const at = clock.now();
    await prisma.warmupMessage.updateMany({
      where: { id: row.id, status: "SENDING" },
      data: { status: "SENT", sentAt: at },
    });
    await prisma.emailAccount.updateMany({ where: { id: from.id }, data: { lastWarmupAt: at } });
    return true;
  };

  const received = async (peer: Live) =>
    prisma.warmupMessage.count({
      where: {
        toAccountId: peer.accountId,
        kind: { in: ["SEND", "REPLY"] },
        status: { not: "FAILED" },
        dueAt: {
          gte: localMidnightUtc(dayKey(peer.account.timezone, now), peer.account.timezone),
          lte: now,
        },
      },
    });

  // (2) due replies, then (3) one new send, per mailbox; (2)+(3) share the day's target and the 600 s spacing
  await mapLimit(live, 4, async (s) => {
    if (deps.signal?.aborted) return;
    const a = s.account;
    const win = window(a.timezone, s.weekdaysOnly);
    const target = warmupTarget(s, a, now);
    if (!isInWindow([win], now) || target < 1) return;
    let last = a.lastWarmupAt?.getTime() ?? 0;
    const spaced = () => now.getTime() - last >= MIN_GAP_MS;
    const dayStart = localMidnightUtc(dayKey(a.timezone, now), a.timezone);
    const today = await prisma.warmupMessage.count({
      where: {
        fromAccountId: a.id,
        kind: { in: ["SEND", "REPLY"] },
        status: { in: ["SENDING", "SENT"] },
        sentAt: { gte: dayStart },
      },
    });
    let n = today;

    if (n < target && spaced()) {
      const replies = await prisma.warmupMessage.findMany({
        where: { fromAccountId: a.id, kind: "REPLY", status: "PLANNED", dueAt: { lte: now } },
        orderBy: { dueAt: "asc" },
        take: 5,
      });
      for (const r of replies) {
        const parent = r.parentId
          ? await prisma.warmupMessage.findUnique({ where: { id: r.parentId } })
          : null;
        const peer = byId.get(r.toAccountId);
        if (!parent || !peer) continue; // waits; abandoned when it is late
        const claim = await prisma.warmupMessage.updateMany({
          where: { id: r.id, status: "PLANNED" },
          data: { status: "SENDING", sentAt: now },
        });
        if (!claim.count) continue;
        if (await send(a, peer.account.email, r, parent)) {
          out.replied++;
          n++;
          last = now.getTime();
        }
        break;
      }
    }

    if (n >= target || !spaced() || (s.nextAt && s.nextAt > now)) return;
    const peers = live.filter(
      (p) => p.workspaceId === s.workspaceId && p.accountId !== s.accountId,
    );
    const mine = domainOf(a.email);
    const ranked = await Promise.all(peers.map(async (p) => ({ p, got: await received(p) })));
    const peer = ranked.sort(
      (x, y) =>
        Number(domainOf(x.p.account.email) === mine) -
          Number(domainOf(y.p.account.email) === mine) ||
        x.got - y.got ||
        x.p.accountId.localeCompare(y.p.accountId),
    )[0]?.p;
    if (!peer) return;
    // shortcut: window end taken as local 20:00 by plain addition, an hour off on a DST-change day
    const secLeft = Math.max(
      0,
      Math.floor((dayStart.getTime() + TO_HOUR * 3600_000 - now.getTime()) / 1000),
    );
    const gap = Math.max(600, Math.floor(secLeft / (target - n)));
    const claim = await prisma.warmupSettings.updateMany({
      where: { accountId: s.accountId, OR: [{ nextAt: null }, { nextAt: { lte: now } }] },
      data: { nextAt: new Date(now.getTime() + gap * 1000) },
    });
    if (!claim.count) return;
    const row = await prisma.warmupMessage.create({
      data: {
        workspaceId: s.workspaceId,
        fromAccountId: a.id,
        toAccountId: peer.accountId,
        kind: "SEND",
        status: "SENDING",
        rfcMessageId: newMessageId(domainOf(a.email)),
        subject: `[${s.filterTag}] Mailbox warm-up ${randomBytes(4).toString("hex")}`,
        dueAt: now,
        sentAt: now,
      },
    });
    if (await send(a, peer.account.email, row)) out.sent++;
  });

  // (4) where did it land: INBOX is seen by sync; anything else is asked once, from the recipient's mailbox
  const stale = await prisma.warmupMessage.findMany({
    where: {
      status: "SENT",
      receivedAt: null,
      checkedAt: null,
      OR: [
        { kind: "PLACEMENT", sentAt: { lte: ago(10 * MIN) } },
        { kind: { not: "PLACEMENT" }, sentAt: { lte: ago(LOCATE_AFTER_MS) } },
      ],
    },
    orderBy: { sentAt: "asc" },
    take: 100,
  });
  const to = new Map(
    (
      await prisma.emailAccount.findMany({
        where: {
          id: { in: [...new Set(stale.map((r) => r.toAccountId))] },
          deletedAt: null,
          credentialsEnc: { not: null },
          status: "CONNECTED",
          lifecycle: { not: "NEEDS_ATTENTION" },
          provider: { in: sendable },
        },
      })
    ).map((x) => [x.id, x]),
  );
  await mapLimit(stale, 4, async (r) => {
    const acct = to.get(r.toAccountId);
    if (!acct || deps.signal?.aborted) return;
    try {
      const loc = await (await deps.providerFor(acct)).locate(r.rfcMessageId);
      const folder = !loc
        ? "MISSING"
        : loc.folder === "INBOX" || loc.folder === "SPAM"
          ? loc.folder
          : "OTHER";
      const w = await prisma.warmupMessage.updateMany({
        where: { id: r.id, checkedAt: null, receivedAt: null },
        data: { landedFolder: folder, checkedAt: clock.now() },
      });
      out.located += w.count;
    } catch (e) {
      if (e instanceof AuthError) await recordProviderError(prisma, clock, acct.id, e);
    }
  });
  return out;
}

/** 30-day (or `days`) table for the account: zeros filled. Where the mail it SENT landed, what it received and replied. */
export async function warmupStats(
  prisma: Db,
  ws: string,
  accountId: string,
  days: number,
  now: Date,
): Promise<WarmupDay[]> {
  const a = await prisma.emailAccount.findFirst({
    where: { id: accountId, workspaceId: ws },
    select: { timezone: true },
  });
  if (!a) return [];
  const today = dayKey(a.timezone, now);
  const keys = Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(today) - (days - 1 - i) * DAY).toISOString().slice(0, 10),
  );
  const out = new Map<string, WarmupDay>(
    keys.map((day) => [
      day,
      { day, sent: 0, received: 0, replied: 0, inbox: 0, spam: 0, missing: 0 },
    ]),
  );
  const since = new Date(Date.parse(keys[0]!) - DAY);
  const rows = await prisma.warmupMessage.findMany({
    where: {
      workspaceId: ws,
      kind: { not: "PLACEMENT" },
      OR: [
        { fromAccountId: accountId, status: "SENT", sentAt: { gte: since } },
        { toAccountId: accountId, receivedAt: { gte: since } },
      ],
    },
  });
  const at = (d: Date | null) => (d ? out.get(dayKey(a.timezone, d)) : undefined);
  for (const r of rows) {
    if (r.fromAccountId === accountId && r.sentAt) {
      const d = at(r.sentAt);
      if (d) {
        d.sent++;
        if (r.kind === "REPLY") d.replied++;
        if (r.landedFolder === "INBOX") d.inbox++;
        else if (r.landedFolder === "SPAM") d.spam++;
        else if (r.landedFolder === "MISSING") d.missing++;
      }
    }
    if (r.toAccountId === accountId) {
      const d = at(r.receivedAt);
      if (d) d.received++;
    }
  }
  return [...out.values()];
}

/** Settings (defaults when none), the PS-WARM-10 state, and the number of usable peers. */
export async function warmupView(
  prisma: Db,
  a: EmailAccount,
  now: Date,
  sendable: AccountProvider[],
) {
  const s = await prisma.warmupSettings.findUnique({ where: { accountId: a.id } });
  const peers = await prisma.warmupSettings.count({
    where: { ...usable(sendable, a.workspaceId), accountId: { not: a.id } },
  });
  const full = { ...WARMUP_DEFAULTS, filterTag: null, startedAt: null, nextAt: null, ...s };
  return {
    settings: full,
    state: warmupState(a, s, peers, sendable),
    peers,
    todayTarget: s ? warmupTarget(s, a, now) : 0,
  };
}
