import type { PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { renderForLead } from "../planner";
import { validateTemplate, type TemplateIssue } from "../template";
import { unsubscribeUrl, type RenderEnv } from "../unsubscribe";
import { campaignVariables } from "./sequence";
import { CampaignError } from "./service";

export type PreviewIssue = Pick<TemplateIssue, "message"> & {
  code: TemplateIssue["code"] | "physical_address_required" | "render_failed";
  field?: "subject" | "body";
};
export const previewInput = z.strictObject({
  stepId: z.string().min(1),
  variantId: z.string().min(1),
  leadId: z.string().min(1),
  accountId: z.string().min(1).optional(),
});

const MISSING_ADDRESS = "[Your physical address: set it in Settings]";

/**
 * What the sender would send for this lead (same `renderForLead`), as data. Template and footer problems come back as
 * `issues` and never throw; an empty address renders a placeholder. 404 for a foreign campaign / step / variant / lead.
 * `testSafe` swaps the lead's real unsubscribe link for a dead one: a test recipient must not be able to opt the lead out.
 */
export async function previewMessage(
  db: PrismaClient,
  ws: string,
  p: {
    campaignId: string;
    stepId: string;
    variantId: string;
    leadId: string;
    accountId?: string | null;
    testSafe?: boolean;
  },
  env: RenderEnv,
): Promise<{
  subject: string;
  html: string | null;
  text: string;
  issues: PreviewIssue[];
  accountId: string;
}> {
  const gone = () => new CampaignError(404, "Not found");
  const campaign = await db.campaign.findFirst({
    where: { id: p.campaignId, workspaceId: ws, deletedAt: null },
  });
  const [step, variant, lead, workspace] = await Promise.all([
    db.sequenceStep.findFirst({
      where: { id: p.stepId, campaignId: p.campaignId, deletedAt: null },
    }),
    db.stepVariant.findFirst({ where: { id: p.variantId, stepId: p.stepId } }),
    db.lead.findFirst({ where: { id: p.leadId, workspaceId: ws, deletedAt: null } }),
    db.workspace.findUniqueOrThrow({ where: { id: ws } }),
  ]);
  if (!campaign || !step || !variant || !lead) throw gone();
  const account = await db.emailAccount.findFirst({
    where: {
      workspaceId: ws,
      deletedAt: null,
      ...(p.accountId ? { id: p.accountId } : { campaigns: { some: { campaignId: campaign.id } } }),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!account) throw new CampaignError(409, "Assign an account to preview");

  const known = await campaignVariables(db, campaign.id);
  const issues: PreviewIssue[] = [
    ...validateTemplate(variant.subject, known).map((i) => ({ ...i, field: "subject" as const })),
    ...validateTemplate(variant.body, known).map((i) => ({ ...i, field: "body" as const })),
  ];
  const noAddress = !workspace.physicalAddress?.trim();
  if (noAddress)
    issues.push({
      code: "physical_address_required",
      message: "Add your physical address in Settings.",
    });
  try {
    const r = renderForLead({
      campaign,
      step,
      variant,
      lead,
      account,
      workspace: {
        ...workspace,
        physicalAddress: noAddress ? MISSING_ADDRESS : workspace.physicalAddress,
      },
      env,
      customKeys: known,
    });
    if (p.testSafe) {
      const url = unsubscribeUrl(env, { w: ws, l: lead.id, c: campaign.id }, account.email);
      const dead = (s: string) => s.replaceAll(url, "(unsubscribe disabled in test emails)");
      return {
        subject: r.subject,
        html: r.html && dead(r.html),
        text: dead(r.text),
        issues,
        accountId: account.id,
      };
    }
    return { subject: r.subject, html: r.html, text: r.text, issues, accountId: account.id };
  } catch (e) {
    // Template errors are already in `issues` (validateTemplate); anything else is reported once.
    if (!issues.some((i) => i.field))
      issues.push({
        code: "render_failed",
        message: e instanceof Error ? e.message : "Render failed",
      });
    return { subject: "", html: null, text: "", issues, accountId: account.id };
  }
}
