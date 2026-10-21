import type { Prisma } from "@rightnow/db/client";

type Tx = Prisma.TransactionClient;
export type Match = {
  leadId: string | null;
  campaignId: string | null;
  campaignLeadId: string | null;
  scheduledMessageId: string | null;
  threadId: string | null;
};
const NONE: Match = {
  leadId: null,
  campaignId: null,
  campaignLeadId: null,
  scheduledMessageId: null,
  threadId: null,
};
const DAY = 86_400_000;
const SM = {
  id: true,
  campaignId: true,
  campaignLeadId: true,
  accountId: true,
  campaignLead: { select: { leadId: true } },
} as const;

/** Strips repeated Re:/Fw:/Fwd:/AW:/WG:/SV:/Antw: prefixes, trims, lowercases. */
export function normalizeSubject(s: string): string {
  const re = /^\s*(re|fw|fwd|aw|wg|sv|antw)\s*:\s*/i;
  while (re.test(s)) s = s.replace(re, "");
  return s.trim().toLowerCase();
}

/**
 * Where a message belongs. Order, first hit wins for lead/campaign: (0, OUT) its own Message-ID is one of our sends;
 * (1) In-Reply-To then References newest first against our sends; (2) the same ids against stored Messages;
 * (3) providerThreadId on this mailbox; (4) D17: the counterpart is a live Lead we mailed from this mailbox in the last
 * 90 days with the same normalized subject, else the lead alone. Threads are per mailbox: a thread of another account
 * is never joined (its lead/campaign carry over). A hit without a thread still takes the first thread the later steps
 * find. `ownId` is the message's own Message-ID; `at` its date (anchor of the 90 days).
 */
export async function matchMessage(
  tx: Tx,
  ws: string,
  accountId: string,
  m: {
    inReplyTo: string | null;
    references: string[];
    providerThreadId?: string;
    counterpart: string;
    subject: string;
    direction: "IN" | "OUT";
    ownId?: string | null;
    at?: Date;
  },
): Promise<Match> {
  const fromSend = async (sm: {
    id: string;
    campaignId: string;
    campaignLeadId: string;
    accountId: string;
    campaignLead: { leadId: string };
  }): Promise<Match> => ({
    leadId: sm.campaignLead.leadId,
    campaignId: sm.campaignId,
    campaignLeadId: sm.campaignLeadId,
    scheduledMessageId: sm.id,
    threadId:
      sm.accountId === accountId
        ? ((
            await tx.message.findFirst({
              where: { workspaceId: ws, accountId, scheduledMessageId: sm.id },
              select: { threadId: true },
            })
          )?.threadId ?? null)
        : null,
  });

  const hits: Match[] = [];
  if (m.direction === "OUT" && m.ownId) {
    const own = await tx.scheduledMessage.findFirst({
      where: { workspaceId: ws, rfcMessageId: m.ownId },
      select: SM,
    });
    if (own) hits.push(await fromSend(own));
  }
  const ids = [
    ...new Set([m.inReplyTo, ...[...m.references].reverse()].filter((x): x is string => !!x)),
  ];
  const rank = (id: string | null) => (id ? ids.indexOf(id) : -1);
  if (ids.length) {
    const sends = await tx.scheduledMessage.findMany({
      where: {
        workspaceId: ws,
        rfcMessageId: { in: ids },
        status: { in: ["SENT", "UNCERTAIN", "HELD"] },
      },
      select: { ...SM, rfcMessageId: true },
    });
    sends.sort((a, b) => rank(a.rfcMessageId) - rank(b.rfcMessageId));
    for (const sm of sends) hits.push(await fromSend(sm));
    const msgs = await tx.message.findMany({
      where: { workspaceId: ws, rfcMessageId: { in: ids } },
      select: {
        rfcMessageId: true,
        accountId: true,
        threadId: true,
        leadId: true,
        campaignId: true,
        scheduledMessageId: true,
      },
    });
    msgs.sort(
      (a, b) =>
        rank(a.rfcMessageId) - rank(b.rfcMessageId) ||
        Number(a.accountId !== accountId) - Number(b.accountId !== accountId),
    );
    for (const x of msgs) {
      const cl =
        x.leadId && x.campaignId
          ? await tx.campaignLead.findFirst({
              where: { workspaceId: ws, leadId: x.leadId, campaignId: x.campaignId },
              select: { id: true },
            })
          : null;
      hits.push({
        leadId: x.leadId,
        campaignId: x.campaignId,
        campaignLeadId: cl?.id ?? null,
        scheduledMessageId: x.scheduledMessageId,
        threadId: x.accountId === accountId ? x.threadId : null,
      });
    }
  }
  let base: Match | null = hits[0] ?? null;
  let threadId = hits.find((h) => h.threadId)?.threadId ?? null;
  if (!threadId && m.providerThreadId) {
    const t = await tx.thread.findFirst({
      where: { workspaceId: ws, accountId, providerThreadId: m.providerThreadId },
      orderBy: { lastMessageAt: "desc" },
    });
    if (t) {
      threadId = t.id;
      base ??= {
        ...NONE,
        leadId: t.leadId,
        campaignId: t.campaignId,
        campaignLeadId: t.campaignLeadId,
      };
    }
  }
  if (base?.leadId) return { ...base, threadId };

  const lead = await tx.lead.findFirst({
    where: { workspaceId: ws, email: m.counterpart.toLowerCase(), deletedAt: null },
    select: { id: true },
  });
  if (!lead) return { ...(base ?? NONE), threadId };
  const subj = normalizeSubject(m.subject);
  const since = new Date((m.at ?? new Date()).getTime() - 90 * DAY);
  const recent = await tx.scheduledMessage.findMany({
    where: {
      workspaceId: ws,
      accountId,
      status: "SENT",
      sentAt: { gte: since },
      campaignLead: { leadId: lead.id },
    },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { ...SM, renderedSubject: true },
  });
  const hit = recent.find((s) => normalizeSubject(s.renderedSubject) === subj);
  if (hit) {
    const h = await fromSend(hit);
    return { ...h, threadId: threadId ?? h.threadId };
  }
  const last = await tx.scheduledMessage.findFirst({
    where: { workspaceId: ws, status: "SENT", campaignLead: { leadId: lead.id } },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    select: { campaignId: true, campaignLeadId: true },
  });
  return {
    leadId: lead.id,
    campaignId: last?.campaignId ?? null,
    campaignLeadId: last?.campaignLeadId ?? null,
    scheduledMessageId: null,
    threadId,
  };
}
