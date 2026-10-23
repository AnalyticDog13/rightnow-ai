import { dashboardSummary, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { pct, StatTile } from "../../../components/stat-tile";
import { Card } from "../../../components/ui/card";
import { rateTip } from "../analytics/query";
import { getSessionInfo } from "../../../lib/workspace";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const d = await dashboardSummary(prisma, info.workspaceId, systemClock.now());
  const m = d.metrics7d;
  const base = "contacted";
  const used = d.allowanceToday ? Math.min(100, (d.sentToday / d.allowanceToday) * 100) : 0;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      <section aria-labelledby="today" className="flex flex-col gap-3">
        <h2 id="today" className="text-lg font-medium">
          Today
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Sent today"
            value={`${d.sentToday} / ${d.allowanceToday}`}
            title="Accepted by the provider (not proof of delivery)"
            note="of today's allowance"
          />
          <StatTile
            label="Remaining capacity"
            value={String(d.remainingToday)}
            note="sends left today across accounts"
          />
          <StatTile
            label="Workspace daily cap"
            value={d.workspaceCap === null ? "No cap" : String(d.workspaceCap)}
          />
          <Card className="flex flex-col justify-center gap-2 p-4">
            <label htmlFor="allowance" className="text-sm text-muted-foreground">
              Allowance used
            </label>
            <progress id="allowance" max={100} value={used} className="w-full" />
          </Card>
        </div>
      </section>

      <section aria-labelledby="week" className="flex flex-col gap-3">
        <h2 id="week" className="text-lg font-medium">
          Last 7 days
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Reply rate"
            value={pct(d.rates7d.reply)}
            title={rateTip(m.replied, m.rateBase, base)}
          />
          <StatTile
            label="Positive reply rate"
            value={pct(d.rates7d.positiveReply)}
            title={rateTip(m.opportunities, m.replied, "replied leads")}
          />
          <StatTile
            label="Bounce rate"
            value={pct(d.rates7d.bounce)}
            title={rateTip(m.hardBounced, m.sent, "sent")}
          />
        </div>
      </section>

      <section aria-labelledby="campaigns" className="flex flex-col gap-3">
        <h2 id="campaigns" className="text-lg font-medium">
          Active campaigns
        </h2>
        {d.campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active campaigns.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.campaigns.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-col gap-1 p-4">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <Link href={`/campaigns/${c.id}`} className="font-medium underline">
                      {c.name}
                    </Link>
                    <span>
                      {c.completed} of {c.total} leads done, {c.sentToday} sent today
                    </span>
                  </div>
                  <progress
                    aria-label={`${c.name} progress`}
                    max={Math.max(c.total, 1)}
                    value={c.completed}
                    className="w-full"
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="health" className="flex flex-col gap-3">
        <h2 id="health" className="text-lg font-medium">
          <Link href="/accounts" className="underline">
            Email accounts
          </Link>
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.accounts.map((a) => (
            <li key={a.id}>
              <Card className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="truncate">{a.email}</span>
                <span className="shrink-0 text-muted-foreground">
                  {a.displayStatus}, health {a.healthScore ?? "n/a"}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="due" className="flex flex-col gap-3">
        <h2 id="due" className="text-lg font-medium">
          Due now
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {d.tasksDue.map((t) => (
            <li key={t.id}>
              <Link href="/crm?tab=tasks" className="underline">
                {t.title}
              </Link>
              {t.lead && <span className="text-muted-foreground"> ({t.lead.email})</span>}
            </li>
          ))}
          <li>
            <Link href="/inbox" className="underline">
              {d.remindersDue} inbox reminder{d.remindersDue === 1 ? "" : "s"} due
            </Link>
          </li>
        </ul>
        {d.tasksDue.length === 0 && <p className="text-sm text-muted-foreground">No tasks due.</p>}
      </section>
    </div>
  );
}
