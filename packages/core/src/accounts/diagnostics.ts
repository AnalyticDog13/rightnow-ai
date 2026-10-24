import { Prisma, type PrismaClient } from "@rightnow/db/client";
import { AuthError, type Diagnostics } from "@rightnow/providers";
import { audit } from "../audit";
import { systemClock } from "../clock";
import { accountDns, type DomainReport } from "../deliverability/dns";
import { returnToService } from "../deliverability/lifecycle";
import { getEnv, maxStalenessSec } from "../env";
import { accountError } from "./health";
import { AccountError, live, mutate, providerOf, type Opts } from "./service";
import { verifyCname } from "./tracking-domain";

/** Error codes that only a new grant or new credentials can fix: never auto-fixed. */
export const AUTH_CODES = new Set([
  "invalid_grant",
  "unauthorized",
  "scope_revoked",
  "bad_credentials",
  "scope_missing", // only a reconnect can grant the scopes again
]);
/** Checks that prove the account can work (login and scopes); mark-as-fixed requires them to pass. */
const CONNECTION_CHECKS = new Set(["token", "scopes", "imap_login", "smtp_auth"]);

export const connectionOk = (d: Diagnostics) =>
  d.checks.every((c) => c.ok || !CONNECTION_CHECKS.has(c.name));

export const clip = (d: Diagnostics): Diagnostics => ({
  ...d,
  checks: d.checks.map((c) => (c.response ? { ...c, response: c.response.slice(0, 200) } : c)),
});

/** Runs the provider's checks; a failure is stored as `lastError` (PS-ACC-15); only a failing connection check flips the account to ERROR. */
export async function runDiagnostics(
  prisma: PrismaClient,
  ws: string,
  id: string,
  o: Opts = {},
): Promise<Diagnostics & { dns: DomainReport | null }> {
  const a = await live(prisma, ws, id);
  if (!a.credentialsEnc) throw new AccountError(409, "reconnect first");
  let d: Diagnostics;
  try {
    d = clip(await (await providerOf(prisma, o)(a)).diagnostics());
  } catch (e) {
    // A thrown AuthError is a failed token; any other throw is transient and must not look like a broken grant.
    d = {
      ok: false,
      checks: [
        e instanceof AuthError
          ? { name: "token", ok: false, code: e.reason, message: e.message }
          : {
              name: "api",
              ok: false,
              code: (e as Error).name,
              message: "diagnostics could not run",
            },
      ],
    };
  }
  // The most severe failure wins, whatever order the provider emitted them in.
  const rank = (c: Diagnostics["checks"][number]) =>
    CONNECTION_CHECKS.has(c.name) ? (AUTH_CODES.has(c.code ?? "") ? 0 : 1) : 2;
  const bad = d.checks.filter((c) => !c.ok).sort((x, y) => rank(x) - rank(y))[0];
  if (bad) {
    const code = bad.code ?? bad.name;
    // Only a failing connection check marks the account ERROR; anything else (scopes, api, a thrown
    // transient error) is recorded in lastError and leaves status alone.
    const connection = CONNECTION_CHECKS.has(bad.name);
    const auth = connection && AUTH_CODES.has(code);
    await prisma.$transaction(async (tx) => {
      const r = await tx.emailAccount.updateMany({
        where: { id, workspaceId: ws, deletedAt: null },
        data: {
          ...(connection && { status: "ERROR" as const }),
          lastError: {
            kind: "CONNECTION",
            code,
            command: bad.command,
            response: bad.response,
            message: bad.message,
          } as Prisma.InputJsonObject,
          lastErrorAt: (o.clock ?? systemClock).now(),
        },
      });
      if (!r.count) return;
      // User pause wins: an auth failure never replaces PAUSED (the error still shows via lastError).
      // Rev 2 R5: already NEEDS_ATTENTION matches nothing, so the ACCOUNT_ERROR is written once
      if (
        auth &&
        (
          await tx.emailAccount.updateMany({
            where: { id, workspaceId: ws, lifecycle: { notIn: ["PAUSED", "NEEDS_ATTENTION"] } },
            data: { lifecycle: "NEEDS_ATTENTION" },
          })
        ).count
      )
        await accountError(tx, { id, workspaceId: ws }, "auth", (o.clock ?? systemClock).now());
      await audit(tx, { workspaceId: ws, actorId: o.actorId }, "account.diagnostics", id, {
        code,
        check: bad.name,
      });
    });
  }
  // informational like DNS: a tracking domain that does not resolve to this app never changes the status (PS-ACC-24)
  if (a.trackingDomain) {
    const host = new URL(getEnv().APP_URL).hostname;
    const ok = (await verifyCname(a.trackingDomain, host, o.resolveCname)) === "VERIFIED";
    d.checks.push({
      name: "tracking_cname",
      ok,
      ...(!ok && { code: "cname_missing", message: `${a.trackingDomain} has no CNAME to ${host}` }),
    });
  }
  // DNS is informational: it never changes the account status. No resolver (tests, callers that skip it) = no DNS section.
  return { ...d, dns: o.resolver ? await accountDns(prisma, o.resolver, ws, a) : null };
}

/** 409 with the diagnostics as body while the connection checks still fail. A user pause stays. */
export async function markFixed(prisma: PrismaClient, ws: string, id: string, o: Opts = {}) {
  const d = await runDiagnostics(prisma, ws, id, o);
  if (!connectionOk(d)) throw new AccountError(409, "diagnostics still failing", d);
  const a = await live(prisma, ws, id);
  return mutate(
    prisma,
    ws,
    id,
    o,
    {
      status: "CONNECTED",
      lastError: Prisma.DbNull,
      lastErrorAt: null,
      errorCount24h: 0,
      autofixState: "NONE",
    },
    "account.mark_fixed",
    undefined,
    async (tx) => {
      if (a.lifecycle === "NEEDS_ATTENTION")
        await returnToService(tx, o.clock ?? systemClock, a, { lookaheadSec: maxStalenessSec() });
    },
  );
}
