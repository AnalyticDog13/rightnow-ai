import { randomBytes } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { dashboardSummary } from "../src/analytics/dashboard";
import { analytics } from "../src/analytics/metrics";
import { analyticsQuery } from "../src/analytics/query";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const NOW = new Date("2026-11-02T12:00:00Z");
const TODAY = new Date("2026-11-02T00:00:00Z");
const hex = () => randomBytes(4).toString("hex");

test("dashboardSummary: capacity (M14), campaigns, tasks, reminders, 7-day rates", async () => {
  const ws = (await P().workspace.create({ data: { name: "W", slug: `w-${hex()}` } })).id;
  const acct = (email: string, dailyLimit: number, o: object = {}) =>
    P().emailAccount.create({
      data: {
        workspaceId: ws,
        provider: "MICROSOFT",
        capTier: "MS365",
        providerCap: 5000,
        email,
        fromName: "F",
        firstName: "F",
        lastName: "L",
        dailyLimit,
        healthScore: 90,
        ...o,
      },
    });
  const a = await acct("a@d.test", 30);
  const b = await acct("b@d.test", 20);
  const gone = await acct("c@d.test", 50, { deletedAt: NOW });
  await P().accountDailyUsage.createMany({
    data: [
      { accountId: a.id, day: TODAY, sent: 5, reserved: 1 },
      { accountId: gone.id, day: TODAY, sent: 9, reserved: 0 },
      { accountId: b.id, day: new Date("2026-11-01T00:00:00Z"), sent: 20, reserved: 0 }, // yesterday
    ],
  });

  const camp = (name: string, status: "ACTIVE" | "DRAFT" | "COMPLETED" | "PAUSED") =>
    P().campaign.create({ data: { workspaceId: ws, name, status } });
  const active = await camp("live", "ACTIVE");
  const paused = await camp("paused", "PAUSED");
  await camp("draft", "DRAFT");
  await camp("done", "COMPLETED");

  const task = (title: string, dueAt: Date | null, status: "OPEN" | "DONE" = "OPEN") =>
    P().task.create({ data: { workspaceId: ws, title, dueAt, status } });
  const overdue = await task("overdue", new Date("2026-10-30T09:00:00Z"));
  const today = await task("today", new Date("2026-11-02T18:00:00Z"));
  await task("tomorrow", new Date("2026-11-03T09:00:00Z"));
  await task("done", new Date("2026-10-30T09:00:00Z"), "DONE");
  await task("undated", null);
  for (let i = 0; i < 12; i++) await task(`old${i}`, new Date(Date.UTC(2026, 9, 1 + i)));

  const thread = (reminderAt: Date | null) =>
    P().thread.create({
      data: { workspaceId: ws, accountId: a.id, subject: "s", lastMessageAt: NOW, reminderAt },
    });
  await thread(new Date("2026-11-02T11:00:00Z"));
  await thread(new Date("2026-11-03T11:00:00Z"));
  await thread(null);

  const lead = await P().lead.create({ data: { workspaceId: ws, email: `l-${hex()}@x.test` } });
  const ev = (type: "ACCEPTED" | "REPLY", at: string) => ({
    workspaceId: ws,
    type,
    occurredAt: new Date(at),
    leadId: lead.id,
    campaignId: active.id,
    accountId: a.id,
    scheduledMessageId: `sm-${hex()}`,
    dedupeKey: `d:${hex()}`,
  });
  await P().event.createMany({
    data: [
      ev("ACCEPTED", "2026-10-27T10:00:00Z"), // first of the 7 local days
      ev("REPLY", "2026-11-01T10:00:00Z"),
      { ...ev("ACCEPTED", "2026-10-26T10:00:00Z"), leadId: null }, // 8 days ago: outside
    ],
  });

  const d = await dashboardSummary(P(), ws, NOW);
  expect(d).toMatchObject({
    sentToday: 5,
    allowanceToday: 50,
    remainingToday: 44,
    workspaceCap: null,
    remindersDue: 1,
  });
  expect(d.campaigns.map((c) => c.id).sort()).toEqual([active.id, paused.id].sort());
  // at most 10, soonest due first
  expect(d.tasksDue.map((t) => t.title)).toEqual(Array.from({ length: 10 }, (_, i) => `old${i}`));
  expect(d.accounts.map((x) => [x.id, x.healthScore])).toEqual([
    [a.id, 90],
    [b.id, 90],
  ]);
  expect(d.accounts[0]!.displayStatus).toBeTruthy();
  const week = await analytics(
    P(),
    ws,
    analyticsQuery.parse({ from: "2026-10-27", to: "2026-11-02" }),
  );
  expect(d.rates7d).toEqual(week.total.rates);
  expect(d.rates7d.reply).toBe(1);

  // M14: the workspace cap bounds the sum of the accounts' remaining
  await P().workspace.update({ where: { id: ws }, data: { dailyCap: 40 } });
  await P().workspaceDailyUsage.create({
    data: { workspaceId: ws, day: TODAY, sent: 5, reserved: 1 },
  });
  expect(await dashboardSummary(P(), ws, NOW)).toMatchObject({
    remainingToday: 34,
    workspaceCap: 40,
  });
  await P().workspace.update({ where: { id: ws }, data: { dailyCap: 3 } });
  expect((await dashboardSummary(P(), ws, NOW)).remainingToday).toBe(0);

  // tasks: only the overdue and today OPEN ones, by due date
  await P().task.deleteMany({ where: { workspaceId: ws, title: { startsWith: "old" } } });
  expect((await dashboardSummary(P(), ws, NOW)).tasksDue.map((t) => t.id)).toEqual([
    overdue.id,
    today.id,
  ]);
});
