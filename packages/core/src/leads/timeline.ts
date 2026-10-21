import type { PrismaClient } from "@rightnow/db/client";
import { hashValue } from "./suppression";

export type TimelineEntry = {
  at: Date;
  kind:
    "imported" | "enrolled" | "sent" | "status_changed" | "merged" | "unsubscribed" | "suppressed";
  detail: Record<string, unknown>;
};

/** PS-LEAD-19 (P3 part): everything that happened to a lead, newest first. P4 adds opens/clicks/replies, P6 notes/tasks. */
export async function leadTimeline(
  prisma: PrismaClient,
  ws: string,
  leadId: string,
): Promise<TimelineEntry[]> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId: ws } });
  if (!lead) return [];
  const [job, enrolled, sent, audits, sup] = await Promise.all([
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
  ]);
  const out: TimelineEntry[] = [];
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
  for (const s of sup)
    out.push({
      at: s.createdAt,
      kind: s.reason === "UNSUBSCRIBE" ? "unsubscribed" : "suppressed",
      detail: { reason: s.reason },
    });
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}
