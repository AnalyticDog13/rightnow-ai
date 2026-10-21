import type { Prisma } from "@rightnow/db/client";
import type {
  AccountProvider,
  Campaign,
  EmailAccount,
  EspType,
  PrismaClient,
} from "@rightnow/db/client";
import { accountOk } from "./dispatch";
import { effectiveAllowance } from "./quota";
import type { EspRule } from "./campaigns/schema";
import { dayKey, startOfNextDay } from "./schedule";

type Db = PrismaClient | Prisma.TransactionClient;
type Esp = "google" | "outlook" | "other";

const senderEsp = (p: AccountProvider): Esp =>
  p === "GMAIL" ? "google" : p === "MICROSOFT" ? "outlook" : "other";
const recipientEsp = (e: EspType): Esp =>
  e === "GOOGLE" ? "google" : e === "MICROSOFT" ? "outlook" : "other";

/** PS-CAMP-24: any matching do_not_send rule excludes; when send rules exist, at least one must match. */
export function routeAllowed(rules: EspRule[], account: AccountProvider, leadEsp: EspType) {
  const hit = (r: EspRule) =>
    (r.recipientEsp === "all" || r.recipientEsp === recipientEsp(leadEsp)) &&
    (r.senderEsp === "all" || r.senderEsp === senderEsp(account));
  if (rules.some((r) => r.action === "do_not_send" && hit(r))) return false;
  const send = rules.filter((r) => r.action === "send");
  return !send.length || send.some(hit);
}

/** Units already spoken for today: sent + reserved + SCHEDULED rows due before the account's next local midnight. */
export async function committedToday(db: Db, a: EmailAccount, now: Date) {
  const [u, queued] = await Promise.all([
    db.accountDailyUsage.findUnique({
      where: {
        accountId_day: { accountId: a.id, day: new Date(`${dayKey(a.timezone, now)}T00:00:00Z`) },
      },
    }),
    db.scheduledMessage.findMany({
      where: {
        accountId: a.id,
        status: "SCHEDULED",
        dueAt: { lt: startOfNextDay(a.timezone, now) },
      },
      select: { cc: true, bcc: true },
    }),
  ]);
  const used = (u?.sent ?? 0) + (u?.reserved ?? 0);
  return { used, scheduled: queued.reduce((n, r) => n + 1 + r.cc.length + r.bcc.length, 0) };
}

/**
 * The sender for a new step-1 row, or null. Eligibility = the claim's own account predicate (`accountOk`) plus
 * assignment, tags, ESP routing and remaining allowance. Pure read: no locks, no provider calls.
 * Order: matchProvider preference, then least committed today, then oldest lastSentAt (nulls first), then id.
 */
export async function pickAccount(
  db: Db,
  p: {
    campaign: Campaign;
    leadEsp: EspType;
    now: Date;
    stalenessSec: number;
    sendableProviders: AccountProvider[];
  },
): Promise<EmailAccount | null> {
  const { campaign: c, now } = p;
  const ids = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "EmailAccount" a
    WHERE ${accountOk(now.toISOString(), p)}
      AND EXISTS (SELECT 1 FROM "CampaignAccount" ca WHERE ca."campaignId" = ${c.id} AND ca."accountId" = a.id)`;
  const rules = (c.espRoutingRules ?? []) as EspRule[];
  const accounts = (
    await db.emailAccount.findMany({ where: { id: { in: ids.map((r) => r.id) } } })
  ).filter(
    (a) =>
      (!c.accountTags.length || a.tags.some((t) => c.accountTags.includes(t))) &&
      routeAllowed(rules, a.provider, p.leadEsp),
  );
  const ranked: { a: EmailAccount; load: number }[] = [];
  for (const a of accounts) {
    const { used, scheduled } = await committedToday(db, a, now);
    if (effectiveAllowance(a, now) - used - scheduled > 0)
      ranked.push({ a, load: used + scheduled });
  }
  // shortcut: the allowance term excludes re-warm/health ctx, as the claim's does today; add both here when it does
  const matches = (a: EmailAccount) =>
    (p.leadEsp === "GOOGLE" && a.provider === "GMAIL") ||
    (p.leadEsp === "MICROSOFT" && a.provider === "MICROSOFT");
  const preferred = c.matchProvider ? ranked.filter((r) => matches(r.a)) : [];
  const pool = preferred.length ? preferred : ranked;
  pool.sort(
    (x, y) =>
      x.load - y.load ||
      (x.a.lastSentAt?.getTime() ?? -1) - (y.a.lastSentAt?.getTime() ?? -1) ||
      (x.a.id < y.a.id ? -1 : 1),
  );
  return pool[0]?.a ?? null;
}
