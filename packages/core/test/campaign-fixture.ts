import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@rightnow/db/client";

type Db = PrismaClient | Prisma.TransactionClient;
type Sched = { timezone: string; days: number; from: string; to: string };

/** Test-only (D16): nothing in Phase 3 writes lastSyncCompletedAt, so tests mark accounts fresh directly. */
export const markFresh = (prisma: Db, accountIds: string[], at: Date) =>
  prisma.emailAccount.updateMany({
    where: { id: { in: accountIds } },
    data: { lastSyncCompletedAt: at },
  });

/** Inserts a SCHEDULED row directly, so claim tests do not depend on the planner. */
export async function planRow(
  prisma: Db,
  p: {
    workspaceId: string;
    campaignId: string;
    campaignLeadId: string;
    stepId: string;
    variantId?: string | null;
    accountId: string;
    dueAt: Date;
  } & Partial<Prisma.ScheduledMessageUncheckedCreateInput>,
) {
  return prisma.scheduledMessage.create({
    data: {
      idempotencyKey: `${p.campaignLeadId}:${p.stepId}`,
      renderedSubject: "Hi",
      renderedBody: "<p>Hello</p>",
      renderedText: "Hello",
      ...p,
    },
  });
}

export const anyTimeUtc: Sched = { timezone: "UTC", days: 127, from: "00:00", to: "24:00" };

/**
 * A sendable ACTIVE campaign: workspace with an address, `accounts` fresh at `at` (SMTP, dailyLimit 5, gaps 0), an
 * anyTime UTC schedule, a main step 1 (+ `steps - 1` follow-ups) with one variant each, `leads` ACTIVE CampaignLeads on
 * step 1, and `rows` SCHEDULED step-1 rows due at `at`, round-robin over the accounts.
 */
export async function seedCampaign(
  prisma: PrismaClient,
  opts: {
    at: Date;
    workspaceId?: string;
    workspace?: Partial<Prisma.WorkspaceCreateInput>;
    accounts?: Partial<Prisma.EmailAccountUncheckedCreateInput>[];
    campaign?: Partial<Prisma.CampaignUncheckedCreateInput>;
    schedules?: Sched[];
    steps?: number;
    leads?: number;
    rows?: number;
  },
) {
  const tag = randomBytes(4).toString("hex");
  const ws =
    opts.workspaceId ??
    (
      await prisma.workspace.create({
        data: { name: "W", slug: `w-${tag}`, physicalAddress: "1 Main St", ...opts.workspace },
      })
    ).id;
  const accounts = [];
  for (const [i, a] of (opts.accounts ?? [{}, {}]).entries())
    accounts.push(
      await prisma.emailAccount.create({
        data: {
          workspaceId: ws,
          provider: "SMTP",
          email: `s${i}-${tag}@send.test`,
          fromName: "S",
          firstName: "S",
          lastName: "T",
          capTier: "SMTP",
          providerCap: 100,
          dailyLimit: 5,
          lastSyncCompletedAt: opts.at,
          nextSendAt: new Date(0),
          ...a,
        },
      }),
    );
  const campaign = await prisma.campaign.create({
    data: {
      workspaceId: ws,
      name: `c-${tag}`,
      status: "ACTIVE",
      minGapSec: 0,
      randomGapSec: 0,
      ...opts.campaign,
    },
  });
  await prisma.campaignAccount.createMany({
    data: accounts.map((a) => ({ campaignId: campaign.id, accountId: a.id })),
  });
  await prisma.campaignSchedule.createMany({
    data: (opts.schedules ?? [anyTimeUtc]).map((s) => ({
      campaignId: campaign.id,
      name: "s",
      ...s,
    })),
  });
  const steps = [];
  for (let order = 1; order <= (opts.steps ?? 1); order++) {
    const s = await prisma.sequenceStep.create({
      data: { campaignId: campaign.id, order, delayValue: order === 1 ? 0 : 1 },
    });
    const v = await prisma.stepVariant.create({
      data: { stepId: s.id, label: "A", subject: "Hi", body: "Hello" },
    });
    steps.push({ ...s, variant: v });
  }
  const leads = [];
  for (let i = 0; i < (opts.leads ?? opts.rows ?? 0); i++) {
    const lead = await prisma.lead.create({
      data: { workspaceId: ws, email: `l${i}-${tag}@lead${i}-${tag}.test` },
    });
    const cl = await prisma.campaignLead.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        leadId: lead.id,
        state: "ACTIVE",
        currentStepId: steps[0]!.id,
      },
    });
    leads.push({ lead, cl });
  }
  const rows = [];
  for (let i = 0; i < (opts.rows ?? 0); i++)
    rows.push(
      await planRow(prisma, {
        workspaceId: ws,
        campaignId: campaign.id,
        campaignLeadId: leads[i]!.cl.id,
        stepId: steps[0]!.id,
        variantId: steps[0]!.variant.id,
        accountId: accounts[i % accounts.length]!.id,
        dueAt: opts.at,
      }),
    );
  return { ws, campaign, accounts, steps, leads, rows };
}
