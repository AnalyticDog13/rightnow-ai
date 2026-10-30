import { dashboardSummary, systemClock, type DisplayStatus } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { Check, Info } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HealthRing } from "../../../components/health-ring";
import { PageHeader } from "../../../components/page-header";
import { pct, StatTile } from "../../../components/stat-tile";
import { ACCOUNT_STATUS, pillFor, StatusPill, stripeFor } from "../../../components/status-pill";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";
import { STATUS_LABEL } from "../accounts/account-status";
import { rateTip } from "../analytics/query";
import { ProgressRing } from "../campaigns/progress-ring";
import { StatusBadge } from "../campaigns/status-badge";
import { getSessionInfo } from "../../../lib/workspace";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/** Principle 4: a rate over fewer than 20 sends is not shown as a number. */
const MIN_BASE = 20;
const rate = (r: number | null, base: number) => (base < MIN_BASE ? "n/a" : pct(r));
const thinNote = (base: number) => (base < MIN_BASE ? "Not enough data" : undefined);

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const ws = info.workspaceId;
  const [d, workspace, leads, launched] = await Promise.all([
    dashboardSummary(prisma, ws, systemClock.now()),
    prisma.workspace.findUniqueOrThrow({ where: { id: ws }, select: { physicalAddress: true } }),
    prisma.lead.count({ where: { workspaceId: ws } }),
    prisma.campaign.count({ where: { workspaceId: ws, launchedAt: { not: null } } }),
  ]);
  const m = d.metrics7d;
  const used = d.allowanceToday ? Math.min(100, (d.sentToday / d.allowanceToday) * 100) : 0;
  const bounceHigh = (d.rates7d.bounce ?? 0) > 0.02 && m.sent >= MIN_BASE;
  // problem accounts first (B5.2), then by email as the API sorts them
  const accounts = d.accounts
    .map((a) => {
      const label = STATUS_LABEL[a.displayStatus as DisplayStatus] ?? a.displayStatus;
      return { ...a, label, spec: pillFor(ACCOUNT_STATUS, label) };
    })
    .sort((a, b) => rank(a.spec.tone) - rank(b.spec.tone));

  return (
    <div className="flex max-w-300 flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Today's sending, the last 7 days, and what needs you."
      />

      <SetupChecklist
        steps={[
          {
            title: "Connect an email account",
            description: "Campaigns send from your own mailboxes.",
            done: d.accounts.length > 0,
            action: { label: "Connect account", href: "/accounts" },
          },
          {
            title: "Add your physical address",
            description: "It is required in every email footer.",
            done: !!workspace.physicalAddress?.trim(),
            action: { label: "Open Settings", href: "/settings#workspace" },
          },
          {
            title: "Import leads",
            description: "Upload a CSV of the people you want to reach.",
            done: leads > 0,
            action: { label: "Import leads", href: "/leads" },
          },
          {
            title: "Launch your first campaign",
            description: "Write a sequence, pick accounts and a schedule, then launch.",
            done: launched > 0,
            action: { label: "Create campaign", href: "/campaigns" },
            locked:
              d.accounts.length === 0 || leads === 0
                ? "Needs an account and leads first"
                : undefined,
          },
        ]}
      />

      <section aria-labelledby="today" className="flex flex-col gap-4">
        <h2 id="today" className="text-base font-semibold">
          Today
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Sent today"
            value={String(d.sentToday)}
            of={d.allowanceToday}
            variant="meter"
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
          <Card className="flex min-h-26 flex-col gap-1 p-4 xl:p-5">
            <label htmlFor="allowance" className="text-[13px]/[18px] text-fg-muted">
              Allowance used
            </label>
            <p className="text-[28px]/8 font-semibold tracking-[-0.01em] tabular-nums">
              {Math.round(used)}%
            </p>
            <progress id="allowance" max={100} value={used} className="mt-1 w-full" />
          </Card>
        </div>
      </section>

      <section aria-labelledby="week" className="flex flex-col gap-4">
        <h2 id="week" className="text-base font-semibold">
          Last 7 days
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Reply rate"
            value={rate(d.rates7d.reply, m.rateBase)}
            title={rateTip(m.replied, m.rateBase, "contacted")}
            note={thinNote(m.rateBase)}
          />
          <StatTile
            label="Positive reply rate"
            value={rate(d.rates7d.positiveReply, m.replied)}
            title={rateTip(m.opportunities, m.replied, "replied leads")}
            note={thinNote(m.replied)}
          />
          <StatTile
            label="Bounce rate"
            value={rate(d.rates7d.bounce, m.sent)}
            title={rateTip(m.hardBounced, m.sent, "sent")}
            note={thinNote(m.sent)}
            className={cn(bounceHigh && "stripe-danger")}
          />
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Card className="flex min-w-0 flex-col gap-4 p-0 md:p-0">
          <h2 id="campaigns" className="px-4 pt-4 text-base font-semibold md:px-5 md:pt-5">
            Active campaigns
          </h2>
          {d.campaigns.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-4 pb-4 md:px-5 md:pb-5">
              <p className="text-[13px]/[18px] text-fg-muted">No active campaigns.</p>
              <Button asChild variant="link">
                <Link href="/campaigns">Open campaigns</Link>
              </Button>
            </div>
          ) : (
            <ul aria-labelledby="campaigns" className="flex flex-col">
              {d.campaigns.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-col gap-2 border-t border-border px-4 py-3 md:px-5"
                >
                  <div className="flex items-center gap-3">
                    <ProgressRing done={c.completed} total={c.total} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                        <StatusBadge status={c.status} />
                      </span>
                      <span className="text-[13px]/[18px] text-fg-muted tabular-nums">
                        {c.completed} of {c.total} leads done, {c.sentToday} sent today
                      </span>
                    </div>
                  </div>
                  <progress
                    aria-label={`${c.name} progress`}
                    max={Math.max(c.total, 1)}
                    value={c.completed}
                    className="w-full"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex min-w-0 flex-col gap-4">
          <h2 id="due" className="text-base font-semibold">
            Due now
          </h2>
          <ul aria-labelledby="due" className="flex flex-col gap-2 text-sm">
            {d.tasksDue.map((t) => (
              <li key={t.id} className="flex min-w-0 flex-col">
                <Link href="/crm?tab=tasks" className="truncate font-medium hover:underline">
                  {t.title}
                </Link>
                {t.lead && (
                  <span className="truncate text-[13px]/[18px] text-fg-subtle">{t.lead.email}</span>
                )}
              </li>
            ))}
            {d.tasksDue.length === 0 && (
              <li className="text-[13px]/[18px] text-fg-muted">No tasks due.</li>
            )}
            <li className="border-t border-border pt-2">
              <Link href="/inbox" className="text-signal hover:underline">
                {d.remindersDue} inbox reminder{d.remindersDue === 1 ? "" : "s"} due
              </Link>
            </li>
          </ul>
        </Card>
      </div>

      <section aria-labelledby="health" className="flex flex-col gap-4">
        <h2 id="health" className="text-base font-semibold">
          <Link href="/accounts" className="hover:underline">
            Email accounts
          </Link>
        </h2>
        {accounts.length === 0 ? (
          <p className="text-[13px]/[18px] text-fg-muted">No email accounts yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "flex min-h-12 min-w-0 items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2",
                  stripeFor(a.spec.tone),
                )}
              >
                <HealthRing score={a.healthScore} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm" title={a.email}>
                  {a.email}
                </span>
                <StatusPill {...a.spec}>{a.label}</StatusPill>
                <span className="sr-only">
                  {a.displayStatus}, health {a.healthScore ?? "n/a"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const rank = (tone: string) => (tone === "danger" ? 0 : tone === "warning" ? 1 : 2);

type Step = {
  title: string;
  description: string;
  done: boolean;
  action: { label: string; href: string };
  locked?: string;
};

/** B4.15: shown while any step is open; the first open step is the current one and the only one with an action. */
function SetupChecklist({ steps }: { steps: Step[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const current = steps.findIndex((s) => !s.done && !s.locked);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="setup" className="text-base font-semibold">
            Get ready to send
          </h2>
          <span className="text-[13px]/[18px] text-fg-muted tabular-nums">
            {done} of {steps.length} done
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          className="h-1 overflow-hidden rounded-xs bg-sunken"
        >
          <div
            className="h-full bg-success-solid"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <ol className="flex flex-col">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          return (
            <li
              key={s.title}
              className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border py-2 first:border-t-0 max-md:items-start"
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full font-mono text-xs font-medium",
                  s.done
                    ? "bg-success-solid text-white"
                    : isCurrent
                      ? "ring-2 ring-fg ring-inset"
                      : "bg-sunken text-fg-subtle",
                )}
              >
                {s.done ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-sm font-medium", s.done && "text-fg-muted")}>
                  {s.title}
                </span>
                <span className="text-[13px]/[18px] text-fg-muted">{s.description}</span>
              </span>
              {isCurrent ? (
                <Button asChild variant="outline" size="sm" className="max-md:w-full">
                  <Link href={s.action.href}>{s.action.label}</Link>
                </Button>
              ) : (
                !s.done &&
                s.locked && (
                  <span className="text-[13px]/[18px] text-fg-subtle max-md:w-full max-md:pl-9">
                    {s.locked}
                  </span>
                )
              )}
            </li>
          );
        })}
      </ol>
      <p className="flex items-center gap-1.5 text-[13px]/[18px] text-fg-muted">
        <Info className="size-3.5 shrink-0" aria-hidden />
        Warm new accounts for at least two weeks before full volume.
      </p>
    </Card>
  );
}
