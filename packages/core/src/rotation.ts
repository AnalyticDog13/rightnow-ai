import type { Prisma } from "@rightnow/db/client";
import type {
  AccountProvider,
  Campaign,
  EmailAccount,
  EspType,
  PrismaClient,
} from "@rightnow/db/client";
import { accountOk, companyGateOk } from "./dispatch";
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

/** The campaign's account-tag restriction (empty = any account). */
export const tagsAllowed = (c: Pick<Campaign, "accountTags">, a: Pick<EmailAccount, "tags">) =>
  !c.accountTags.length || a.tags.some((t) => c.accountTags.includes(t));

/**
 * Units already spoken for today, per account, in two grouped queries whatever the number of accounts:
 * sent + reserved on the account's local day, and SCHEDULED rows (1 + cc + bcc each) due before its next local midnight.
 */
export async function committedToday(db: Db, accounts: EmailAccount[], now: Date) {
  const out = new Map<string, { used: number; scheduled: number }>();
  if (!accounts.length) return out;
  const ids = accounts.map((a) => a.id);
  const days = accounts.map((a) => dayKey(a.timezone, now));
  const cutoffs = accounts.map((a) => startOfNextDay(a.timezone, now).toISOString());
  const [used, queued] = await Promise.all([
    db.$queryRaw<{ id: string; n: number }[]>`
      SELECT t.id, COALESCE(SUM(u.sent + u.reserved), 0)::int AS n
      FROM unnest(${ids}::text[], ${days}::text[]) AS t(id, day)
      LEFT JOIN "AccountDailyUsage" u ON u."accountId" = t.id AND u.day = t.day::date
      GROUP BY t.id`,
    db.$queryRaw<{ id: string; n: number }[]>`
      SELECT t.id, COALESCE(SUM(1 + COALESCE(cardinality(sm.cc), 0) + COALESCE(cardinality(sm.bcc), 0)), 0)::int AS n
      FROM unnest(${ids}::text[], ${cutoffs}::text[]) AS t(id, cutoff)
      LEFT JOIN "ScheduledMessage" sm ON sm."accountId" = t.id AND sm.status = 'SCHEDULED'
        AND sm."dueAt" < t.cutoff::timestamp
      GROUP BY t.id`,
  ]);
  for (const id of ids) out.set(id, { used: 0, scheduled: 0 });
  for (const r of used) out.get(r.id)!.used = r.n;
  for (const r of queued) out.get(r.id)!.scheduled = r.n;
  return out;
}

/** The one allowance rule for rotation and the explainer: effectiveAllowance minus everything already committed today. */
export const remainingToday = (
  a: EmailAccount,
  c: { used: number; scheduled: number },
  now: Date,
) =>
  // shortcut: no re-warm ctx, as the claim; add it here and in the claim together, upgrade in P5-T05/T06
  effectiveAllowance(a, now) - c.used - c.scheduled;

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
  // stopForCompanyOnReply: the claim takes nothing while any assigned account is stale or NEEDS_ATTENTION, so assign nothing
  const [blocked] = await db.$queryRaw<unknown[]>`
    SELECT 1 FROM "Campaign" c WHERE c.id = ${c.id} AND NOT ${companyGateOk(now.toISOString(), p)}`;
  if (blocked) return null;
  const ids = await db.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "EmailAccount" a
    WHERE ${accountOk(now.toISOString(), p)}
      AND EXISTS (SELECT 1 FROM "CampaignAccount" ca WHERE ca."campaignId" = ${c.id} AND ca."accountId" = a.id)`;
  const rules = (c.espRoutingRules ?? []) as EspRule[];
  const accounts = (
    await db.emailAccount.findMany({ where: { id: { in: ids.map((r) => r.id) } } })
  ).filter((a) => tagsAllowed(c, a) && routeAllowed(rules, a.provider, p.leadEsp));
  const committed = await committedToday(db, accounts, now);
  const ranked = accounts.flatMap((a) => {
    const k = committed.get(a.id)!;
    return remainingToday(a, k, now) > 0 ? [{ a, load: k.used + k.scheduled }] : [];
  });
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
