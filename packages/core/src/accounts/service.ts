import {
  Prisma,
  type AccountProvider,
  type AccountStatus,
  type EmailAccount,
  type PrismaClient,
} from "@rightnow/db/client";
import type { MailProvider } from "@rightnow/providers";
import { z } from "zod";
import { audit } from "../audit";
import { type Clock, systemClock } from "../clock";
import type { DnsResolver } from "../deliverability/dns";
import { updateWarmup } from "../deliverability/warmup-settings";
import { returnToService } from "../deliverability/lifecycle";
import { getEnv, maxStalenessSec } from "../env";
import { applyLimits, type LimitWarning } from "./caps";
import { setCredentials } from "./credentials";
import { dayKey } from "./daykey";
import { createProvider } from "./factory";
import { type ApiAccount, toApiAccount } from "./serialize";
import { type CnameResolver, verifyCname } from "./tracking-domain";

/** Service failure with an HTTP-ish status; the web layer maps it to a response. */
export class AccountError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 429 | 502,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export type Opts = {
  clock?: Clock;
  actorId?: string | null;
  role?: string;
  /** Tests inject a stub; the default builds the real provider (or the Fake under MAIL_PROVIDER_FAKE). */
  providerFor?: (a: EmailAccount) => MailProvider | Promise<MailProvider>;
  resolveCname?: CnameResolver;
  /** DNS checks in diagnostics; omitted = skipped. */
  resolver?: DnsResolver;
};
type Db = PrismaClient;
const RECONNECT = "reconnect or mark as fixed first";
const now = (o: Opts) => (o.clock ?? systemClock).now();
export const providerOf = (prisma: Db, o: Opts) => (a: EmailAccount) =>
  (o.providerFor ?? ((x) => createProvider(x, { prisma, clock: o.clock })))(a);

export async function live(prisma: Db, ws: string, id: string): Promise<EmailAccount> {
  const a = await prisma.emailAccount.findFirst({
    where: { id, workspaceId: ws, deletedAt: null },
  });
  if (!a) throw new AccountError(404, "Not found");
  return a;
}

/** Rows plus today's real usage (account timezone). */
export async function accountViews(
  prisma: Db,
  rows: EmailAccount[],
  at: Date,
): Promise<ApiAccount[]> {
  const keys = rows.map((r) => dayKey(r.timezone, at));
  const usage = await prisma.accountDailyUsage.findMany({
    where: {
      accountId: { in: rows.map((r) => r.id) },
      day: { in: [...new Set(keys)].map((k) => new Date(`${k}T00:00:00Z`)) },
    },
  });
  const by = new Map(usage.map((u) => [`${u.accountId}|${u.day.toISOString().slice(0, 10)}`, u]));
  return rows.map((r, i) =>
    toApiAccount(r, by.get(`${r.id}|${keys[i]}`) ?? { sent: 0, reserved: 0 }, at),
  );
}

export async function getAccount(prisma: Db, ws: string, id: string, o: Opts = {}) {
  const a = await prisma.emailAccount.findFirst({
    where: { id, workspaceId: ws, deletedAt: null },
  });
  return a ? (await accountViews(prisma, [a], now(o)))[0]! : null;
}

export const listQuery = z.strictObject({
  status: z.enum(["CONNECTED", "ERROR", "DISCONNECTED"]).optional(),
  provider: z.enum(["GMAIL", "MICROSOFT", "SMTP"]).optional(),
  tag: z.string().min(1).optional(),
  includeDeleted: z.stringbool().optional(),
  cursor: z.string().min(1).optional(),
  take: z.coerce.number().int().min(1).max(500).optional(),
});
type ListQuery = {
  status?: AccountStatus;
  provider?: AccountProvider;
  tag?: string;
  includeDeleted?: boolean;
  cursor?: string;
  take?: number;
};

export async function listAccounts(prisma: Db, ws: string, q: ListQuery, o: Opts = {}) {
  const take = q.take ?? 100;
  const rows = await prisma.emailAccount.findMany({
    where: {
      workspaceId: ws,
      ...(q.includeDeleted ? {} : { deletedAt: null }),
      ...(q.status && { status: q.status }),
      ...(q.provider && { provider: q.provider }),
      ...(q.tag && { tags: { has: q.tag } }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(q.cursor && { cursor: { id: q.cursor }, skip: 0 }),
  });
  const next = rows.length > take ? rows.pop()! : null;
  return { accounts: await accountViews(prisma, rows, now(o)), nextCursor: next?.id ?? null };
}

/** One write plus its audit row in a transaction; 404 when no live account of this workspace matched. */
export async function mutate(
  prisma: Db,
  ws: string,
  id: string,
  o: Opts,
  data: Prisma.EmailAccountUpdateManyMutationInput,
  action: string,
  meta?: Record<string, string | number | boolean | null | string[]>,
  /** Runs in the same transaction, after `data` is written (e.g. returnToService). */
  then?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  await prisma.$transaction(async (tx) => {
    const r = await tx.emailAccount.updateMany({
      where: { id, workspaceId: ws, deletedAt: null },
      data,
    });
    if (!r.count) throw new AccountError(404, "Not found");
    await then?.(tx);
    await audit(tx, { workspaceId: ws, actorId: o.actorId }, action, id, meta);
  });
  return (await getAccount(prisma, ws, id, o))!;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const tag = z.string().trim().min(1).max(50);
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "unknown timezone");
export const patchSchema = z
  .strictObject({
    fromName: text(200),
    firstName: text(100),
    lastName: z.string().trim().max(100),
    replyTo: z.email().max(320).nullable(),
    signature: z.string().max(10_000).nullable(),
    tags: z
      .array(tag)
      .max(50)
      .transform((t) => [...new Set(t)]),
    dailyLimit: z.number().int().min(0).max(1_000_000),
    minGapSec: z.number().int().min(0).max(86_400),
    randomGapSec: z.number().int().min(0).max(86_400),
    timezone,
    slowRamp: z.boolean(),
    rampStartVolume: z.number().int().min(1).max(10_000),
    rampIncrementPerDay: z.number().int().min(0).max(10_000),
    historyImportDays: z.number().int().min(0).max(365),
    providerCap: z.number().int().min(1).max(1_000_000),
    appendToSent: z.boolean(),
    placementSeed: z.boolean(),
    trackingDomain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, "not a hostname")
      .nullable(),
    skipCnameCheck: z.boolean(),
  })
  .partial();

export async function updateAccount(
  prisma: Db,
  ws: string,
  id: string,
  patch: unknown,
  o: Opts = {},
) {
  const p = patchSchema.parse(patch);
  const cur = await live(prisma, ws, id);
  const isAdmin = o.role === "ADMIN" || o.role === "OWNER";
  if (p.skipCnameCheck && !isAdmin) throw new AccountError(403, "Forbidden");
  const { skipCnameCheck, trackingDomain, ...rest } = p;
  const { values, warnings } = applyLimits(cur.capTier, cur, p);
  const data: Prisma.EmailAccountUpdateManyMutationInput = { ...rest, ...values };
  // Turning the ramp on (again) restarts it: a mailbox paused from ramping must not jump to full volume.
  if (p.slowRamp && !cur.slowRamp) data.rampStartedAt = now(o);
  if (trackingDomain !== undefined) {
    data.trackingDomain = trackingDomain;
    data.trackingDomainStatus =
      trackingDomain === null
        ? "UNVERIFIED"
        : skipCnameCheck
          ? "VERIFIED"
          : await verifyCname(trackingDomain, new URL(getEnv().APP_URL).hostname, o.resolveCname);
  }
  const account = await mutate(prisma, ws, id, o, data, "account.update", {
    fields: Object.keys(p),
    ...(skipCnameCheck && { skipCnameCheck: true }),
  });
  return { account, warnings };
}

export async function pauseAccount(
  prisma: Db,
  ws: string,
  id: string,
  until: Date | undefined,
  o: Opts = {},
) {
  if (until && until <= now(o)) throw new AccountError(400, "until must be in the future");
  if ((await live(prisma, ws, id)).lifecycle === "NEEDS_ATTENTION")
    throw new AccountError(409, RECONNECT);
  return mutate(
    prisma,
    ws,
    id,
    o,
    { lifecycle: "PAUSED", pausedUntil: until ?? null },
    "account.pause",
    {
      until: until?.toISOString() ?? null,
    },
  );
}

export async function resumeAccount(prisma: Db, ws: string, id: string, o: Opts = {}) {
  const a = await live(prisma, ws, id);
  if (a.lifecycle === "NEEDS_ATTENTION") throw new AccountError(409, RECONNECT);
  if (a.status === "DISCONNECTED") throw new AccountError(409, "reconnect first");
  if (a.lifecycle !== "PAUSED") return (await getAccount(prisma, ws, id, o))!;
  // Rev 2 I2: conditional on the PAUSED state read above; health restarts and a SOFT_BOUNCE goes in returnToService
  await prisma.$transaction(async (tx) => {
    const r = await tx.emailAccount.updateMany({
      where: {
        id,
        workspaceId: ws,
        deletedAt: null,
        lifecycle: "PAUSED",
        pausedUntil: a.pausedUntil,
      },
      data: { consecutivePermanentErrors: 0 },
    });
    if (!r.count) return; // changed meanwhile: that change wins
    await returnToService(tx, o.clock ?? systemClock, a, { lookaheadSec: maxStalenessSec() });
    await audit(tx, { workspaceId: ws, actorId: o.actorId }, "account.resume", id);
  });
  return (await getAccount(prisma, ws, id, o))!;
}

/** Disconnect and delete: revoke at the provider (best effort), then drop credentials through the lease-guarded store. */
async function detach(
  prisma: Db,
  ws: string,
  id: string,
  o: Opts,
  action: string,
  data: Prisma.EmailAccountUpdateManyMutationInput,
) {
  const a = await live(prisma, ws, id);
  let revoked = false;
  if (a.credentialsEnc) {
    try {
      await (await providerOf(prisma, o)(a)).revoke();
      revoked = true;
    } catch (e) {
      console.warn("provider revoke failed", (e as Error).name); // the user still wants the account detached
    }
  }
  await prisma.$transaction(async (tx) => {
    if (!(await setCredentials(tx, ws, id, null, data))) throw new AccountError(404, "Not found");
    await audit(tx, { workspaceId: ws, actorId: o.actorId }, action, id, { revoked });
  });
  return revoked;
}

export async function disconnectAccount(prisma: Db, ws: string, id: string, o: Opts = {}) {
  const revoked = await detach(prisma, ws, id, o, "account.disconnect", {
    status: "DISCONNECTED",
    lifecycle: "PAUSED",
    pausedUntil: null,
  });
  return { account: (await getAccount(prisma, ws, id, o))!, revoked };
}

export async function softDeleteAccount(prisma: Db, ws: string, id: string, o: Opts = {}) {
  const revoked = await detach(prisma, ws, id, o, "account.delete", {
    deletedAt: now(o),
    status: "DISCONNECTED",
    lifecycle: "PAUSED",
    pausedUntil: null,
  });
  return { revoked };
}

const ACTIONS = [
  "pause",
  "resume",
  "set_daily_limit",
  "set_gap",
  "set_signature",
  "add_tags",
  "remove_tags",
  "delete",
  "warmup_enable",
  "warmup_disable",
] as const;
export const bulkSchema = z.strictObject({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(ACTIONS),
  value: z.unknown().optional(),
});

export async function bulkApply(prisma: Db, ws: string, input: unknown, o: Opts = {}) {
  const { ids, action, value } = bulkSchema.parse(input);
  const field = {
    set_daily_limit: "dailyLimit",
    set_gap: "minGapSec",
    set_signature: "signature",
  } as const;
  // Validate the value once, with the same schema a single update uses.
  const v =
    action in field
      ? patchSchema.shape[field[action as keyof typeof field]].parse(value)
      : action === "add_tags" || action === "remove_tags"
        ? patchSchema.shape.tags.parse(value)
        : action === "pause"
          ? z.coerce.date().optional().parse(value)
          : undefined;
  const out: { id: string; ok: boolean; error?: string; warnings?: LimitWarning[] }[] = [];
  for (const id of ids) {
    let warnings: LimitWarning[] = [];
    try {
      if (action === "pause") await pauseAccount(prisma, ws, id, v as Date | undefined, o);
      else if (action === "resume") await resumeAccount(prisma, ws, id, o);
      else if (action === "delete") await softDeleteAccount(prisma, ws, id, o);
      else if (action === "warmup_enable" || action === "warmup_disable")
        await updateWarmup(
          prisma,
          await live(prisma, ws, id),
          { enabled: action === "warmup_enable" },
          { clock: o.clock ?? systemClock, actorId: o.actorId },
        );
      else if (action in field)
        warnings = (
          await updateAccount(prisma, ws, id, { [field[action as keyof typeof field]]: v }, o)
        ).warnings;
      else {
        const have = new Set((await live(prisma, ws, id)).tags);
        const change = v as string[];
        const tags =
          action === "add_tags"
            ? [...have, ...change]
            : [...have].filter((t) => !change.includes(t));
        await updateAccount(prisma, ws, id, { tags }, o);
      }
      out.push({ id, ok: true, ...(warnings.length && { warnings }) });
    } catch (e) {
      const error =
        e instanceof AccountError
          ? e.status === 404
            ? "not_found"
            : e.message
          : e instanceof z.ZodError
            ? "invalid_value"
            : "failed";
      if (error === "failed") console.error("bulk action failed", (e as Error).name);
      out.push({ id, ok: false, error });
    }
  }
  return out;
}
