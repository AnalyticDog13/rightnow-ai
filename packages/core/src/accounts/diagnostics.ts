import { Prisma, type PrismaClient } from "@rightnow/db/client";
import type { Diagnostics } from "@rightnow/providers";
import { systemClock } from "../clock";
import { AccountError, live, mutate, providerOf, type Opts } from "./service";

/** Error codes that only a new grant or new credentials can fix: never auto-fixed. */
export const AUTH_CODES = new Set([
  "invalid_grant",
  "unauthorized",
  "scope_revoked",
  "bad_credentials",
]);
/** Checks that prove the connection itself works; mark-as-fixed requires them to pass. */
const CONNECTION_CHECKS = new Set(["token", "imap_login", "smtp_auth"]);

export const connectionOk = (d: Diagnostics) =>
  d.checks.every((c) => c.ok || !CONNECTION_CHECKS.has(c.name));

const clip = (d: Diagnostics): Diagnostics => ({
  ...d,
  checks: d.checks.map((c) => (c.response ? { ...c, response: c.response.slice(0, 200) } : c)),
});

/** Runs the provider's checks; a failure is stored as `lastError` (PS-ACC-15) and flips the account to ERROR. */
export async function runDiagnostics(
  prisma: PrismaClient,
  ws: string,
  id: string,
  o: Opts = {},
): Promise<Diagnostics & { dns: null }> {
  const a = await live(prisma, ws, id);
  if (!a.credentialsEnc) throw new AccountError(409, "reconnect first");
  let d: Diagnostics;
  try {
    d = clip(await providerOf(prisma, o)(a).diagnostics());
  } catch (e) {
    d = {
      ok: false,
      checks: [
        { name: "api", ok: false, code: (e as Error).name, message: "diagnostics could not run" },
      ],
    };
  }
  const bad = d.checks.find((c) => !c.ok);
  if (bad) {
    const code = bad.code ?? bad.name;
    await prisma.emailAccount.updateMany({
      where: { id, workspaceId: ws, deletedAt: null },
      data: {
        status: "ERROR",
        ...(bad.name === "token" &&
          AUTH_CODES.has(code) && { lifecycle: "NEEDS_ATTENTION" as const }),
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
  }
  return { ...d, dns: null };
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
      ...(a.lifecycle === "NEEDS_ATTENTION" && { lifecycle: "ACTIVE" as const }),
    },
    "account.mark_fixed",
  );
}
