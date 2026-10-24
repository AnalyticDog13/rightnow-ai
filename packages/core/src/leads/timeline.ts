import type { PrismaClient } from "@rightnow/db/client";
import { scopeAllows } from "../apikeys";
import { crmActivity } from "../crm/activity";
import { hashValue } from "./suppression";

export type TimelineEntry = {
  at: Date;
  kind:
    | "imported"
    | "enrolled"
    | "sent"
    | "status_changed"
    | "merged"
    | "unsubscribed"
    | "suppressed"
    | "opened"
    | "clicked"
    | "replied"
    | "bounced"
    | "note"
    | "task"
    | "opportunity";
  detail: Record<string, unknown>;
};

/**
 * PS-LEAD-19 (P3 part): everything that happened to a lead, newest first. P4 adds opens, clicks, replies, bounces and
 * unsubscribes (Event), P6 notes, tasks and deals. As the export (I2): an API key (`c.scopes`) without `crm:read` gets
 * no notes, tasks or deals; no entry carries message text, so nothing depends on `inbox:read`.
 */
export async function leadTimeline(
  prisma: PrismaClient,
  ws: string,
  leadId: string,
  c: { scopes?: string[] } = {},
): Promise<TimelineEntry[]> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId: ws } });
  if (!lead) return [];
  const [job, enrolled, sent, audits, sup, engaged, crm] = await Promise.all([
    lead.importJobId
      ? prisma.importJob.findFirst({ where: { id: lead.importJobId, workspaceId: ws } })
      : null,
    prisma.campaignLead.findMany({
      where: { workspaceId: ws, leadId },
      include: { campaign: { select: { name: true } } },
    }),
    prisma.scheduledMessage.findMany({
      where: { workspaceId: ws, status: "SENT", sentAt: { not: null }, campaignLead: { leadId } },
      include: {
        step: { select: { order: true } },
        variant: { select: { label: true } },
        account: { select: { email: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: ws, target: leadId, action: { in: ["lead.update", "lead.merge"] } },
    }),
    prisma.suppression.findMany({
      where: { workspaceId: ws, kind: "EMAIL", valueHash: hashValue(lead.email) },
    }),
    prisma.event.findMany({
      where: {
        workspaceId: ws,
        leadId,
        type: {
          in: [
            "OPEN",
            "CLICK",
            "REPLY",
            "AUTO_REPLY",
            "UNSUBSCRIBE",
            "BOUNCE_HARD",
            "BOUNCE_SOFT",
            "BOUNCE_UNKNOWN",
          ],
        },
      },
    }),
    // notes, tasks and deals as the CRM feed has them, merged-away leads included
    // shortcut: the newest 200 CRM items; page crmActivity if a lead ever has more
    !c.scopes || scopeAllows(c.scopes, "crm:read")
      ? crmActivity(prisma, ws, { leadId, take: 200 })
      : { items: [] },
  ]);
  const out: TimelineEntry[] = [];
  for (const e of engaged) {
    const meta = (e.meta ?? {}) as Record<string, unknown>;
    if (meta.machine || meta.scanner) continue; // not a person
    const campaignId = e.campaignId;
    if (e.type === "OPEN" || e.type === "CLICK")
      out.push({
        at: e.occurredAt,
        kind: e.type === "OPEN" ? "opened" : "clicked",
        detail: { campaignId, ...(e.type === "CLICK" && { url: meta.url ?? null }) },
      });
    else if (e.type === "REPLY" || e.type === "AUTO_REPLY")
      out.push({
        at: e.occurredAt,
        kind: "replied",
        detail: { campaignId, auto: e.type === "AUTO_REPLY", category: meta.category ?? null },
      });
    else if (e.type === "UNSUBSCRIBE")
      out.push({ at: e.occurredAt, kind: "unsubscribed", detail: { campaignId } });
    else
      out.push({
        at: e.occurredAt,
        kind: "bounced",
        detail: { campaignId, type: e.type.slice(7), recipient: meta.recipient ?? null },
      });
  }
  for (const i of crm.items) {
    const d = i.detail;
    if (i.kind === "reply") continue; // already listed from its Event
    if (i.kind === "task")
      out.push({
        at: i.at,
        kind: "task",
        detail: { action: d.action, title: d.title, status: d.status },
      });
    else if (i.kind === "stage" || i.kind === "opportunity")
      out.push({
        at: i.at,
        kind: "opportunity",
        detail: {
          action: i.kind === "stage" ? "opportunity.stage" : d.action,
          opportunityId: i.opportunityId,
          ...(i.kind === "stage" && { from: d.from, to: d.to }),
        },
      });
    else out.push({ at: i.at, kind: "note", detail: { noteKind: i.kind, body: d.body } });
  }
  const unsubEvent = out.some((x) => x.kind === "unsubscribed");
  if (job) out.push({ at: job.createdAt, kind: "imported", detail: { fileName: job.fileName } });
  for (const e of enrolled)
    out.push({
      at: e.enrolledAt,
      kind: "enrolled",
      detail: { campaignId: e.campaignId, campaign: e.campaign.name },
    });
  for (const m of sent)
    out.push({
      at: m.sentAt!,
      kind: "sent",
      detail: {
        step: m.step.order,
        variant: m.variant?.label ?? null,
        account: m.account.email,
        campaignId: m.campaignId,
      },
    });
  for (const a of audits) {
    const meta = (a.meta ?? {}) as Record<string, unknown>;
    if (a.action === "lead.merge")
      out.push({ at: a.createdAt, kind: "merged", detail: { mergedId: meta.mergedId ?? null } });
    else if ("interestStatus" in meta)
      out.push({
        at: a.createdAt,
        kind: "status_changed",
        detail: { interestStatus: meta.interestStatus },
      });
  }
  // an UNSUBSCRIBE event already tells it, with its campaign
  for (const s of sup)
    if (!(s.reason === "UNSUBSCRIBE" && unsubEvent))
      out.push({
        at: s.createdAt,
        kind: s.reason === "UNSUBSCRIBE" ? "unsubscribed" : "suppressed",
        detail: { reason: s.reason },
      });
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}
