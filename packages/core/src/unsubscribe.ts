import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { isPrivate } from "@rightnow/providers";
import type { Prisma, PrismaClient } from "@rightnow/db/client";
import { stopOpenCampaignLeads } from "./campaigns/hooks";
import { withTxRetry } from "./dispatch";
import type { Clock } from "./clock";
import { suppress } from "./leads/suppression";
import { recordEvent } from "./mail/events";

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
export function hkdfKeys(
  env: { ENCRYPTION_KEY: string; OLD_ENCRYPTION_KEY?: string },
  info: string,
): Buffer[] {
  return [env.ENCRYPTION_KEY, env.OLD_ENCRYPTION_KEY]
    .filter((k): k is string => !!k)
    .map((k) => Buffer.from(hkdfSync("sha256", Buffer.from(k, "base64"), "", info, 32)));
}

export const unsubscribeKeys = (env: { ENCRYPTION_KEY: string; OLD_ENCRYPTION_KEY?: string }) =>
  hkdfKeys(env, "rightnow-unsubscribe-v1");

/** `<base64url json>.<base64url hmac>`: the token format of unsubscribe and tracking links. */
export function signJson(payload: object, key: Buffer): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(body, key))}`;
}

/** null for anything that is not a token we signed with one of `keys`. Every key is tried with a constant-time compare. */
export function verifyJson(token: string, keys: Buffer[]): Record<string, unknown> | null {
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
    const p: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const signUnsubscribe = (p: UnsubPayload, key: Buffer): string =>
  signJson({ w: p.w, l: p.l, c: p.c }, key);

export function verifyUnsubscribe(token: string, keys: Buffer[]): UnsubPayload | null {
  const p = verifyJson(token, keys);
  return p && typeof p.w === "string" && typeof p.l === "string" && typeof p.c === "string"
    ? { w: p.w, l: p.l, c: p.c }
    : null;
}

// The address lands inside a header value: reject anything that is not a plain address (CR/LF, <, >).
const mailto = (acct: string) => {
  if (!z.email().safeParse(acct).success || /[\r\n<>]/.test(acct))
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

/** Suggested footer text for campaigns without a link; classify.ts reads a reply of "unsubscribe" as an opt-out. */
export const DEFAULT_OPT_OUT_TEXT =
  'Not interested? Just reply "unsubscribe" and I won\'t email you again.';

/**
 * The address is always added. Unless the body already used {{unsubscribeLink}}, the footer adds the link, or with
 * `link: false` the opt-out message instead.
 */
export function withComplianceFooter(
  body: { html: string | null; text: string },
  p: {
    unsubscribeUrl: string;
    physicalAddress: string;
    hasLinkVariable: boolean;
    link?: boolean;
    optOutText?: string | null;
  },
): { html: string | null; text: string } {
  if (!p.physicalAddress.trim()) throw new Error("physical_address_required");
  const off = p.link === false && !p.hasLinkVariable;
  const link = !p.hasLinkVariable && !off;
  const msg = off ? p.optOutText?.trim() || DEFAULT_OPT_OUT_TEXT : "";
  return {
    html:
      body.html === null
        ? null
        : `${body.html}<p style="font-size:12px;color:#666">${esc(p.physicalAddress)}${link ? `<br><a href="${esc(p.unsubscribeUrl)}">Unsubscribe</a>` : ""}${msg ? `<br>${esc(msg)}` : ""}</p>`,
    text: `${body.text}\n\n--\n${p.physicalAddress}${link ? `\nUnsubscribe: ${p.unsubscribeUrl}` : ""}${msg ? `\n${msg}` : ""}`,
  };
}

type Tx = Prisma.TransactionClient;

/**
 * I3, in the caller's transaction: suppresses `email` and stops the open enrollments of `leadIds`. "done" when the
 * address was newly suppressed.
 */
export async function optOutTx(
  tx: Tx,
  clock: Clock,
  ws: string,
  email: string,
  leadIds: string[],
  source: string,
): Promise<"done" | "already"> {
  // D21 order: ScheduledMessage rows -> CampaignLead (stopOpenCampaignLeads) -> Suppression.
  // stopReason before suppress(), which would stamp SUPPRESSED on whatever is still open
  await stopOpenCampaignLeads(tx, ws, leadIds, "UNSUBSCRIBED", clock.now());
  return (await suppress(tx, ws, [{ kind: "EMAIL", value: email }], "UNSUBSCRIBE", source)) > 0
    ? "done"
    : "already";
}

/**
 * Opt-out by signed link. Loads the lead by id including soft-deleted and merged-away rows (I10) and suppresses its own
 * email. "already" when the address was already suppressed, or when the lead no longer exists (a GDPR erasure deletes
 * the row and keeps only a suppression hash), so nothing is written. Records one UNSUBSCRIBE event per lead and campaign.
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
  if (!lead) return "already";
  return withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      const r = await optOutTx(tx, clock, p.w, lead.email, [p.l], source);
      await recordEvent(tx, {
        workspaceId: p.w,
        type: "UNSUBSCRIBE",
        occurredAt: clock.now(),
        leadId: p.l,
        campaignId: p.c,
        meta: { source },
        dedupeKey: `unsub:${p.w}:${p.l}:${p.c}`,
      });
      return r;
    }),
  );
}
