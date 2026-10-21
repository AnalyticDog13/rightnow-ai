import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { isPrivate } from "@rightnow/providers";
import type { PrismaClient } from "@rightnow/db/client";
import { editHooks } from "./campaigns/hooks";
import type { Clock } from "./clock";
import { suppress } from "./leads/suppression";

/** "https" only for a public https URL. Pure classification (no DNS): IPs go through the providers' private-range check; names must be dotted and not local. */
export function unsubscribeMode(appUrl: string): "https" | "mailto" {
  let u: URL;
  try {
    u = new URL(appUrl);
  } catch {
    return "mailto";
  }
  const h = u.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const local = isIP(h)
    ? isPrivate(h)
    : !h.includes(".") ||
      h === "localhost" ||
      h === "host.docker.internal" ||
      /\.(local|localhost|internal)$/.test(h);
  return u.protocol === "https:" && !local ? "https" : "mailto";
}

export type UnsubPayload = { w: string; l: string; c: string }; // workspaceId, leadId, campaignId
export type RenderEnv = { appUrl: string; unsubscribeKeys: Buffer[] };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string, key: Buffer) => createHmac("sha256", key).update(body).digest();

/** One HKDF-SHA256 subkey per encryption key (current first, then the old one while old links must still verify). */
export function unsubscribeKeys(env: {
  ENCRYPTION_KEY: string;
  OLD_ENCRYPTION_KEY?: string;
}): Buffer[] {
  return [env.ENCRYPTION_KEY, env.OLD_ENCRYPTION_KEY]
    .filter((k): k is string => !!k)
    .map((k) =>
      Buffer.from(hkdfSync("sha256", Buffer.from(k, "base64"), "", "rightnow-unsubscribe-v1", 32)),
    );
}

export function signUnsubscribe(p: UnsubPayload, key: Buffer): string {
  const body = b64(JSON.stringify({ w: p.w, l: p.l, c: p.c }));
  return `${body}.${b64(mac(body, key))}`;
}

/** null for anything that is not a token we signed with one of `keys`. Every key is tried with a constant-time compare. */
export function verifyUnsubscribe(token: string, keys: Buffer[]): UnsubPayload | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, "base64url");
  let ok = false;
  for (const k of keys) {
    const want = mac(body, k);
    ok = (given.length === want.length && timingSafeEqual(given, want)) || ok;
  }
  if (!ok) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return typeof p.w === "string" && typeof p.l === "string" && typeof p.c === "string"
      ? { w: p.w, l: p.l, c: p.c }
      : null;
  } catch {
    return null;
  }
}

// The address lands inside a header value: reject anything that is not a plain address (CR/LF, <, >).
const mailto = (acct: string) => {
  if (!z.email().safeParse(acct).success || /[
<>]/.test(acct))
    throw new Error("invalid_account_email");
  return `mailto:${acct}?subject=unsubscribe`;
};

export function unsubscribeUrl(env: RenderEnv, p: UnsubPayload, accountEmail: string): string {
  return unsubscribeMode(env.appUrl) === "https"
    ? `${env.appUrl.replace(/\/+$/, "")}/u/${signUnsubscribe(p, env.unsubscribeKeys[0]!)}`
    : mailto(accountEmail);
}

/** RFC 8058: the Post header only goes with an https link. */
export function listUnsubscribeHeaders(
  env: RenderEnv,
  p: UnsubPayload,
  accountEmail: string,
): Record<string, string> {
  const url = unsubscribeUrl(env, p, accountEmail);
  return url.startsWith("mailto:")
    ? { "List-Unsubscribe": `<${url}>` }
    : {
        "List-Unsubscribe": `<${url}>, <${mailto(accountEmail)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
}

const ENT: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENT[c]!);

/** The address is always added; the link only when the body did not already use {{unsubscribeLink}}. */
export function withComplianceFooter(
  body: { html: string | null; text: string },
  p: { unsubscribeUrl: string; physicalAddress: string; hasLinkVariable: boolean },
): { html: string | null; text: string } {
  if (!p.physicalAddress.trim()) throw new Error("physical_address_required");
  const link = !p.hasLinkVariable;
  return {
    html:
      body.html === null
        ? null
        : `${body.html}<p style="font-size:12px;color:#666">${esc(p.physicalAddress)}${link ? `<br><a href="${esc(p.unsubscribeUrl)}">Unsubscribe</a>` : ""}</p>`,
    text: `${body.text}\n\n--\n${p.physicalAddress}${link ? `\nUnsubscribe: ${p.unsubscribeUrl}` : ""}`,
  };
}

type Db = Pick<PrismaClient, "$transaction">;
// shortcut: local copy of T09's withTxRetry (40P01 deadlock / 40001 serialization); switch to it once it exists.
async function retryDeadlock<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      const retry = (e as { code?: string }).code === "P2034" || /40P01|40001/.test(m);
      if (!retry || i >= tries) throw e;
    }
  }
}
const OPEN = ["QUEUED", "ACTIVE", "PAUSED"] as const;

/** Suppresses `email` and stops the open enrollments of `leadIds`. "done" when the address was newly suppressed. */
async function optOut(
  db: Db,
  clock: Clock,
  ws: string,
  email: string,
  leadIds: string[],
  source: string,
) {
  // I4 order: ScheduledMessage rows (cancelOpenRows, T09) -> CampaignLead -> Suppression
  return retryDeadlock(() =>
    db.$transaction(async (tx) => {
      const open = await tx.campaignLead.findMany({
        where: { workspaceId: ws, leadId: { in: leadIds }, state: { in: [...OPEN] } },
        select: { id: true },
      });
      if (open.length) {
        const ids = open.map((c) => c.id);
        await editHooks.cancelOpenRows(tx, ids);
        // stopReason before suppress(), which would stamp SUPPRESSED on whatever is still open
        await tx.campaignLead.updateMany({
          where: { id: { in: ids }, state: { in: [...OPEN] } },
          data: {
            state: "STOPPED",
            stopReason: "UNSUBSCRIBED",
            nextDueAt: null,
            completedAt: clock.now(),
          },
        });
      }
      return (await suppress(tx, ws, [{ kind: "EMAIL", value: email }], "UNSUBSCRIBE", source)) > 0
        ? ("done" as const)
        : ("already" as const);
    }),
  );
}

/**
 * Opt-out by signed link. Loads the lead by id including soft-deleted and merged-away rows (I10) and suppresses its own
 * email. "already" when the address was already suppressed, or when the lead no longer exists (a GDPR erasure deletes
 * the row and keeps only a suppression hash), so nothing is written.
 */
export async function unsubscribeLead(
  prisma: PrismaClient,
  clock: Clock,
  p: UnsubPayload,
  source: "one_click" | "page",
): Promise<"done" | "already"> {
  const lead = await prisma.lead.findFirst({
    where: { id: p.l, workspaceId: p.w },
    select: { email: true },
  });
  return lead ? optOut(prisma, clock, p.w, lead.email, [p.l], source) : "already";
}

/** Hook for P4-T02/T03: an "unsubscribe" reply from `fromEmail` to a mailbox of the workspace. */
export async function suppressMailtoUnsubscribe(
  prisma: PrismaClient,
  clock: Clock,
  p: { workspaceId: string; fromEmail: string },
): Promise<"done" | "already"> {
  const email = p.fromEmail.trim().toLowerCase();
  const leads = await prisma.lead.findMany({
    where: { workspaceId: p.workspaceId, email },
    select: { id: true },
  });
  return optOut(
    prisma,
    clock,
    p.workspaceId,
    email,
    leads.map((l) => l.id),
    "mailto",
  );
}
