import { Prisma, type PrismaClient } from "@rightnow/db/client";
import {
  FakeProvider,
  ImapSmtpProvider,
  defaultAppendToSent,
  type Diagnostics,
  type MailProvider,
} from "@rightnow/providers";
import { z } from "zod";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { returnToService } from "../deliverability/lifecycle";
import { getEnv, maxStalenessSec } from "../env";
import { applyLimits } from "./caps";
import { setCredentials } from "./credentials";
import { clip } from "./diagnostics";
import { hostPolicy, TIER_CAP } from "./factory";
import { openAccount } from "./open-account";
import { AccountError, getAccount } from "./service";

const server = z.strictObject({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9.:[\]-]+$/, "not a host name"),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(1024), // never trimmed: spaces can be part of an app password
});
export const smtpConnectInput = z.strictObject({
  email: z
    .email()
    .max(320)
    .transform((e) => e.toLowerCase()),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
  imap: server,
  smtp: server,
  providerCap: z.number().int().min(1).max(1_000_000).optional(),
});
export type SmtpConnectInput = z.infer<typeof smtpConnectInput>;

export type SmtpDeps = {
  /** Tests inject a provider; the default builds the real one, or the Fake under MAIL_PROVIDER_FAKE. */
  providerFor?: (i: SmtpConnectInput) => MailProvider;
};

function providerFor(i: SmtpConnectInput, deps: SmtpDeps): MailProvider {
  if (deps.providerFor) return deps.providerFor(i);
  const creds = { imap: i.imap, smtp: i.smtp };
  if (getEnv().MAIL_PROVIDER_FAKE) {
    const host = [i.imap.host, i.smtp.host].find((h) => h.startsWith("fail.")) ?? i.smtp.host;
    return new FakeProvider(i.email, { kind: "SMTP", host });
  }
  return new ImapSmtpProvider({
    address: i.email,
    credentials: async () => creds,
    appendToSent: defaultAppendToSent(i.smtp.host),
    ...hostPolicy(),
  });
}

/** The same checks the saved account will pass later, run on unsaved credentials. Nothing is stored. */
export async function testSmtpConnection(deps: SmtpDeps, raw: unknown): Promise<Diagnostics> {
  const i = smtpConnectInput.parse(raw);
  try {
    return clip(await providerFor(i, deps).diagnostics());
  } catch (e) {
    return {
      ok: false,
      checks: [
        { name: "api", ok: false, code: (e as Error).name, message: "the checks could not run" },
      ],
    };
  }
}

const isUniqueViolation = (e: unknown) => /P2002|23505/.test(JSON.stringify(e) + String(e));

/** PS-ACC-04. Runs the checks first (failure: 422 with them, nothing saved), then creates or revives the row and stores the encrypted credentials. */
export async function connectSmtpAccount(
  prisma: PrismaClient,
  clock: Clock,
  deps: SmtpDeps,
  workspaceId: string,
  actorId: string | undefined,
  raw: unknown,
) {
  const i = smtpConnectInput.parse(raw);
  const d = await testSmtpConnection(deps, i);
  if (!d.ok) throw new AccountError(422, "connection checks failed", d);

  const tier = "SMTP" as const;
  const { values, warnings } = applyLimits(
    tier,
    { providerCap: TIER_CAP[tier], dailyLimit: 30, minGapSec: 0 },
    { providerCap: i.providerCap },
  );
  const id = await prisma
    .$transaction(async (tx) => {
      const opened = await openAccount(tx, clock, workspaceId, {
        provider: "SMTP",
        email: i.email,
        capTier: tier,
        providerCap: values.providerCap,
        appendToSent: defaultAppendToSent(i.smtp.host),
        fromName: `${i.firstName} ${i.lastName}`.trim(),
        firstName: i.firstName,
        lastName: i.lastName,
      });
      if (!opened) throw new AccountError(409, "account_exists");
      const row = { id: opened };
      // Credentials are written only through setCredentials.
      const stored = await setCredentials(
        tx,
        workspaceId,
        row.id,
        { kind: "smtp", imap: i.imap, smtp: i.smtp },
        { status: "CONNECTED", lastError: Prisma.DbNull, errorCount24h: 0 },
      );
      if (!stored) throw new AccountError(404, "Not found");
      await audit(tx, { workspaceId, actorId }, "account.connect", row.id, {
        provider: "SMTP",
        email: i.email,
      });
      return row.id;
    })
    .catch((e: unknown) => {
      if (!(e instanceof AccountError) && isUniqueViolation(e))
        throw new AccountError(409, "account_exists");
      throw e;
    });
  return { account: (await getAccount(prisma, workspaceId, id, { clock }))!, warnings };
}

export const smtpReconnectInput = z.strictObject({ imap: server, smtp: server });

/**
 * PS-ACC-08 for SMTP/IMAP: new credentials for the SAME account (id, history and limits kept). Same checks as
 * connect (SSRF and TLS rules included) run first, 422 and nothing saved when they fail. The mailbox cannot change.
 */
export async function reconnectSmtpAccount(
  prisma: PrismaClient,
  clock: Clock,
  deps: SmtpDeps,
  workspaceId: string,
  actorId: string | undefined,
  accountId: string,
  raw: unknown,
) {
  const c = smtpReconnectInput.parse(raw);
  const a = await prisma.emailAccount.findFirst({
    where: { id: accountId, workspaceId, deletedAt: null },
  });
  if (!a) throw new AccountError(404, "Not found");
  if (a.provider !== "SMTP") throw new AccountError(409, "not an SMTP/IMAP account");
  const d = await testSmtpConnection(deps, {
    ...c,
    email: a.email,
    firstName: a.firstName || "-",
    lastName: a.lastName,
  });
  if (!d.ok) throw new AccountError(422, "connection checks failed", d);
  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: the lifecycle rule must see the current row.
    const cur = await tx.emailAccount.findFirst({
      where: { id: accountId, workspaceId, deletedAt: null, provider: "SMTP" },
    });
    if (!cur) throw new AccountError(404, "Not found");
    // As the OAuth reconnect: a user pause stays, everything the failure or Disconnect caused is lifted.
    const resume =
      cur.lifecycle === "NEEDS_ATTENTION" ||
      (cur.lifecycle === "PAUSED" && cur.status === "DISCONNECTED");
    const stored = await setCredentials(
      tx,
      workspaceId,
      accountId,
      { kind: "smtp", imap: c.imap, smtp: c.smtp },
      {
        status: "CONNECTED",
        lastError: Prisma.DbNull,
        errorCount24h: 0,
        appendToSent: defaultAppendToSent(c.smtp.host),
      },
    );
    if (!stored) throw new AccountError(404, "Not found");
    if (resume) await returnToService(tx, clock, cur, { lookaheadSec: maxStalenessSec() });
    await audit(tx, { workspaceId, actorId }, "account.reconnect", accountId, {
      provider: "SMTP",
      email: a.email,
    });
  });
  return { account: (await getAccount(prisma, workspaceId, accountId, { clock }))! };
}
