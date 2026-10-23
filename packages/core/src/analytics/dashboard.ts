import type { PrismaClient } from "@rightnow/db/client";
import { accountViews } from "../accounts/service";
import { dayKey } from "../accounts/daykey";
import { campaignOverview } from "../campaigns/service";
import { type ApiTask, listTasks } from "../crm/tasks";
import { effectiveAllowance } from "../quota";
import { analytics, type Metrics } from "./metrics";

const DAY = 86_400_000;
const INACTIVE = ["Draft", "Completed", "Archived"];

/**
 * PS-UI-04 dashboard data. Capacity is today's (each account's own timezone day), and the workspace cap bounds the
 * sum (Rev 2 M14): remaining = min(Σ account remainingToday, dailyCap − (workspace sent + reserved)). Rates are
 * analytics over the last 7 local days of the workspace.
 */
export async function dashboardSummary(
  prisma: PrismaClient,
  ws: string,
  now: Date,
): Promise<{
  sentToday: number;
  allowanceToday: number;
  remainingToday: number;
  workspaceCap: number | null;
  campaigns: Awaited<ReturnType<typeof campaignOverview>>;
  rates7d: Metrics["rates"];
  accounts: { id: string; email: string; displayStatus: string; healthScore: number | null }[];
  tasksDue: ApiTask[];
  remindersDue: number;
}> {
  const [w, rows, campaigns, overdue, dueToday, remindersDue] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: ws },
      select: { timezone: true, dailyCap: true },
    }),
    prisma.emailAccount.findMany({
      where: { workspaceId: ws, deletedAt: null },
      orderBy: { email: "asc" },
    }),
    campaignOverview(prisma, ws, now),
    listTasks(prisma, ws, { due: "overdue", take: 10 }, now),
    listTasks(prisma, ws, { due: "today", take: 10 }, now),
    prisma.thread.count({ where: { workspaceId: ws, deletedAt: null, reminderAt: { lte: now } } }),
  ]);
  const today = dayKey(w.timezone, now);
  const [views, usage, week] = await Promise.all([
    accountViews(prisma, rows, now),
    w.dailyCap === null
      ? null
      : prisma.workspaceDailyUsage.findUnique({
          where: { workspaceId_day: { workspaceId: ws, day: new Date(`${today}T00:00:00Z`) } },
        }),
    analytics(prisma, ws, {
      from: new Date(Date.parse(today) - 6 * DAY).toISOString().slice(0, 10),
      to: today,
      tz: w.timezone,
      includeAutoReplies: false,
      replyBase: "contacted",
      groupBy: "none",
    }),
  ]);
  const accountsLeft = views.reduce((n, a) => n + a.remainingToday, 0);
  return {
    sentToday: views.reduce((n, a) => n + a.sentToday, 0),
    allowanceToday: rows.reduce((n, a) => n + effectiveAllowance(a, now), 0),
    remainingToday:
      w.dailyCap === null
        ? accountsLeft
        : Math.min(
            accountsLeft,
            Math.max(0, w.dailyCap - (usage?.sent ?? 0) - (usage?.reserved ?? 0)),
          ),
    workspaceCap: w.dailyCap,
    campaigns: campaigns.filter((c) => !INACTIVE.includes(c.status)),
    rates7d: week.total.rates,
    accounts: views.map((a) => ({
      id: a.id,
      email: a.email,
      displayStatus: a.displayStatus,
      healthScore: a.health.score,
    })),
    tasksDue: [...overdue, ...dueToday].slice(0, 10),
    remindersDue,
  };
}
