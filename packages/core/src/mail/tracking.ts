import type { EmailAccount, Prisma, PrismaClient } from "@rightnow/db/client";
import type { Clock } from "../clock";
import { withTxRetry } from "../dispatch";
import { enterActivitySubsequence } from "../planner";
import { hkdfKeys, signJson, unsubscribeMode, verifyJson } from "../unsubscribe";
import { recordEvent } from "./events";

type Db = Pick<PrismaClient, "$transaction" | "scheduledMessage">;
export type TrackPayload = { m: string; u?: string; i?: number }; // scheduledMessageId, click url, link index

export const trackingKeys = (env: { ENCRYPTION_KEY: string; OLD_ENCRYPTION_KEY?: string }) =>
  hkdfKeys(env, "rightnow-tracking-v1");

export const signTrack = (p: TrackPayload, key: Buffer): string =>
  signJson({ m: p.m, ...(p.u !== undefined && { u: p.u, i: p.i ?? 0 }) }, key);

export function verifyTrack(token: string, keys: Buffer[]): TrackPayload | null {
  const p = verifyJson(token, keys);
  if (!p || typeof p.m !== "string") return null;
  if (p.u === undefined) return { m: p.m };
  return typeof p.u === "string" && Number.isInteger(p.i)
    ? { m: p.m, u: p.u, i: p.i as number }
    : null;
}

/** D28: a verified tracking domain, else the app URL when it is a public https one, else no tracking. */
export function trackingBase(
  acct: Pick<EmailAccount, "trackingDomain" | "trackingDomainStatus">,
  appUrl: string,
): string | null {
  if (acct.trackingDomain && acct.trackingDomainStatus === "VERIFIED")
    return `https://${acct.trackingDomain}`;
  return unsubscribeMode(appUrl) === "https" ? appUrl.replace(/\/+$/, "") : null;
}

export function withTracking(
  html: string,
  o: {
    base: string;
    scheduledMessageId: string;
    opens: boolean;
    clicks: boolean;
    key: Buffer;
    skipUrls: string[];
  },
): string {
  let out = html;
  // the footer link is any /u/ path on our hosts (tracking base or app URL), whichever key signed it
  const parse = (u: string) => {
    try {
      return new URL(u);
    } catch {
      return null; // malformed: not ours, left as written
    }
  };
  const ours = new Set([o.base, ...o.skipUrls].map((u) => parse(u)?.origin));
  if (o.clicks) {
    let i = 0;
    out = out.replace(/(<a\b[^>]*?\bhref=)(["'])(https?:\/\/.*?)\2/gi, (all, pre, q, href) => {
      const url = href.replace(/&amp;/g, "&");
      const parsed = parse(url);
      if (!parsed) return all;
      if (o.skipUrls.includes(url) || (ours.has(parsed.origin) && parsed.pathname.startsWith("/u/")))
        return all;
      const t = signTrack({ m: o.scheduledMessageId, u: url, i: i++ }, o.key);
      return `${pre}${q}${o.base}/t/c/${t}${q}`;
    });
  }
  if (!o.opens) return out;
  const px = `<img src="${o.base}/t/o/${signTrack({ m: o.scheduledMessageId }, o.key)}" width="1" height="1" alt="" style="display:none">`;
  const at = out.toLowerCase().lastIndexOf("</body>");
  return at < 0 ? out + px : out.slice(0, at) + px + out.slice(at);
}

const MACHINE_UA =
  /GoogleImageProxy|YahooMailProxy|Microsoft Office|ms-office|bot|crawler|scanner|barracuda|mimecast|proofpoint/i;
const MACHINE_WINDOW_MS = 10_000;

async function record(
  prisma: Db,
  clock: Clock,
  p: TrackPayload,
  ua: string | null,
  kind: "OPEN" | "CLICK",
): Promise<void> {
  const m = await prisma.scheduledMessage.findUnique({
    where: { id: p.m },
    include: { campaignLead: { select: { leadId: true } } },
  });
  if (!m?.sentAt) return;
  const now = clock.now();
  const machine =
    MACHINE_UA.test(ua ?? "") || now.getTime() - m.sentAt.getTime() < MACHINE_WINDOW_MS;
  const minute = Math.floor(now.getTime() / 60_000);
  const leadId = m.campaignLead.leadId;
  const open = kind === "OPEN";
  await withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      // lock order: CampaignLead -> Lead
      if (!machine)
        await tx.$queryRaw`SELECT 1 FROM "CampaignLead" WHERE id = ${m.campaignLeadId} FOR NO KEY UPDATE`;
      const fresh = await recordEvent(tx, {
        workspaceId: m.workspaceId,
        type: kind,
        occurredAt: now,
        leadId,
        campaignId: m.campaignId,
        accountId: m.accountId,
        stepId: m.stepId,
        variantId: m.variantId,
        scheduledMessageId: m.id,
        isEstimated: open, // a click is a real request, an open is a guess
        meta: open ? { machine } : { scanner: machine, url: p.u ?? null },
        dedupeKey: open ? `open:${m.id}:${minute}` : `click:${m.id}:${p.i ?? 0}:${minute}`,
      });
      if (!fresh || machine) return;
      const st = await tx.campaignLead.findUnique({ where: { id: m.campaignLeadId } });
      // like a reply (subCl): never a STOPPED enrolment, nor one the user PAUSED
      if (st && ["QUEUED", "ACTIVE", "COMPLETED"].includes(st.state))
        await enterActivitySubsequence(
          tx,
          now,
          m.campaignLeadId,
          m.campaignId,
          open ? "opened" : "clicked",
        );
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        select: { lastEngagement: true },
      });
      const eng = (lead?.lastEngagement ?? {}) as Prisma.JsonObject;
      await tx.lead.updateMany({
        where: { id: leadId, workspaceId: m.workspaceId, deletedAt: null },
        data: open
          ? {
              opens: { increment: 1 },
              lastOpenAt: now,
              lastEngagement: { ...eng, open: now.toISOString() },
            }
          : {
              clicks: { increment: 1 },
              lastClickAt: now,
              lastEngagement: { ...eng, click: now.toISOString() },
            },
      });
    }),
  );
}

export const recordOpen = (prisma: Db, clock: Clock, p: TrackPayload, ua: string | null) =>
  record(prisma, clock, p, ua, "OPEN");
export const recordClick = (prisma: Db, clock: Clock, p: TrackPayload, ua: string | null) =>
  record(prisma, clock, p, ua, "CLICK");
