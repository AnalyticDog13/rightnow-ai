import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@rightnow/db/client";
import {
  TransientBeforeSendError,
  type CredentialStore,
  type OAuthCreds,
} from "@rightnow/providers";
import { type Clock, systemClock } from "../clock";
import { decrypt, encrypt } from "../crypto";

export type MailServer = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};
/** Plaintext of `EmailAccount.credentialsEnc`. */
export type StoredCredentials =
  ({ kind: "oauth" } & OAuthCreds) | { kind: "smtp"; imap: MailServer; smtp: MailServer };

export const encryptCredentials = (c: StoredCredentials) => encrypt(JSON.stringify(c));
export const decryptCredentials = (enc: string) => JSON.parse(decrypt(enc)) as StoredCredentials;

const LEASE_MS = 20_000; // > the 15 s token-call timeout
const MAX_WAIT_MS = 25_000;
const POLL_MS = 250;

/**
 * The only way to replace credentials (disconnect, soft delete, reconnect): clears the refresh lease and
 * bumps `credentialGen`, so a refresh still in flight writes nothing (R2-I1). `data` carries the
 * caller's other fields (status, deletedAt). Returns false (nothing written) when no live account matched in
 * this workspace, including a soft-deleted one: it cannot be reconnected, connect creates a new account.
 */
export async function setCredentials(
  db: Pick<PrismaClient, "emailAccount">,
  workspaceId: string,
  accountId: string,
  creds: StoredCredentials | null,
  data: Prisma.EmailAccountUpdateManyMutationInput = {},
): Promise<boolean> {
  const r = await db.emailAccount.updateMany({
    where: { id: accountId, workspaceId, deletedAt: null }, // soft-deleted accounts are never written
    data: {
      ...data,
      credentialsEnc: creds && encryptCredentials(creds),
      refreshLeaseId: null,
      refreshLeaseUntil: null,
      credentialGen: { increment: 1 },
    },
  });
  return r.count === 1;
}

/** Decrypted on every use, so a reconnect with new credentials reaches running providers. */
export function smtpCredentials(
  prisma: PrismaClient,
  workspaceId: string,
  accountId: string,
): () => Promise<{ imap: MailServer; smtp: MailServer }> {
  return async () => {
    const a = await prisma.emailAccount.findFirst({
      where: { id: accountId, workspaceId, deletedAt: null },
      select: { credentialsEnc: true },
    });
    if (!a?.credentialsEnc) throw new Error(`account ${accountId} has no credentials`);
    const s = decryptCredentials(a.credentialsEnc);
    if (s.kind !== "smtp") throw new Error(`account ${accountId} has no SMTP credentials`);
    return { imap: s.imap, smtp: s.smtp };
  };
}

function oauthCreds(enc: string | null | undefined, accountId: string): OAuthCreds {
  if (!enc) throw new Error(`account ${accountId} has no credentials`);
  const s = decryptCredentials(enc);
  if (s.kind !== "oauth") throw new Error(`account ${accountId} has no OAuth credentials`);
  return {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    expiresAt: s.expiresAt,
    scope: s.scope,
  };
}

/** D13: refresh is serialized per account by a DB lease; the token call runs with no transaction open. */
export function accountCredentialStore(
  prisma: PrismaClient,
  accountId: string,
  deps: { clock?: Clock; sleep?: (ms: number) => Promise<void> } = {},
): CredentialStore<OAuthCreds> {
  const clock = deps.clock ?? systemClock;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const live = { id: accountId, deletedAt: null };

  const get = async () =>
    oauthCreds(
      (await prisma.emailAccount.findFirst({ where: live, select: { credentialsEnc: true } }))
        ?.credentialsEnc,
      accountId,
    );

  return {
    get,
    async refresh(stale, doRefresh) {
      const deadline = clock.now().getTime() + MAX_WAIT_MS;
      for (;;) {
        let lease: { leaseId: string; gen: number };
        for (;;) {
          type Step = OAuthCreds | { leaseId: string; gen: number } | null; // null = wait
          const step = await prisma.$transaction(async (tx): Promise<Step> => {
            await tx.$queryRaw`SELECT 1 FROM "EmailAccount" WHERE "id" = ${accountId} FOR UPDATE`;
            const a = await tx.emailAccount.findFirst({ where: live });
            const current = oauthCreds(a?.credentialsEnc, accountId);
            if (current.accessToken !== stale.accessToken) return current;
            const now = clock.now();
            if (a!.refreshLeaseId && a!.refreshLeaseUntil && a!.refreshLeaseUntil > now)
              return null;
            const leaseId = randomUUID();
            await tx.emailAccount.update({
              where: { id: accountId },
              data: {
                refreshLeaseId: leaseId,
                refreshLeaseUntil: new Date(now.getTime() + LEASE_MS),
              },
            });
            return { leaseId, gen: a!.credentialGen };
          });
          if (step && "accessToken" in step) return step;
          if (step) {
            lease = step;
            break;
          }
          if (clock.now().getTime() >= deadline)
            throw new TransientBeforeSendError("token refresh lease still held by another process");
          await sleep(POLL_MS);
        }

        // Conditional on lease and generation: after expiry, disconnect or reconnect this matches nothing.
        const mine = { ...live, refreshLeaseId: lease.leaseId, credentialGen: lease.gen };
        let next: OAuthCreds;
        try {
          next = await doRefresh(stale);
        } catch (e) {
          const released = await prisma.emailAccount
            .updateMany({ where: mine, data: { refreshLeaseId: null, refreshLeaseUntil: null } })
            .then(
              (r) => r.count,
              () => 1,
            ); // a failed release expires on its own; keep the provider's error
          if (released === 0) {
            // Lease lost or credentials replaced: the old grant's error must not reach a reconnected
            // account (return the new creds) or a disconnected one (get() throws "no credentials").
            const current = await get();
            if (current.accessToken !== stale.accessToken) return current;
          }
          throw e;
        }
        const r = await prisma.emailAccount.updateMany({
          where: mine,
          data: {
            credentialsEnc: encryptCredentials({ kind: "oauth", ...next }),
            refreshLeaseId: null,
            refreshLeaseUntil: null,
          },
        });
        if (r.count === 1) return next;
        // Lost the lease (expired and taken, or credentials replaced). Return new creds, never the stale
        // ones: if the stored token is still `stale`, the new holder is pending, so wait for it (D13 note).
        const current = await get();
        if (current.accessToken !== stale.accessToken) return current;
      }
    },
  };
}
