import {
  deliverabilityOverview,
  getWorkspaceSettings,
  sendableProviders,
  systemClock,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Callout } from "../../../components/callout";
import { PageHeader } from "../../../components/page-header";
import { SectionTabs } from "../../../components/section-tabs";
import { StatTile } from "../../../components/stat-tile";
import { Card } from "../../../components/ui/card";
import { getWebEnv } from "../../../lib/env";
import { getSessionInfo } from "../../../lib/workspace";
import { DeliverabilitySettings } from "./deliverability-settings";
import { DomainSection } from "../accounts/domain-section";
import { DeliverabilityTable } from "./deliverability-table";
import { HealthFormula } from "./health-trend";
import { DELIVERABILITY_TABS } from "./section";

export const metadata: Metadata = { title: "Deliverability" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string | string[] }>;
}) {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const wanted = [(await searchParams).domain].flat()[0]?.toLowerCase();
  const admin = info.role === "OWNER" || info.role === "ADMIN";
  const [rows, settings] = await Promise.all([
    deliverabilityOverview(
      prisma,
      info.workspaceId,
      systemClock.now(),
      await sendableProviders(prisma, getWebEnv()),
    ),
    admin ? getWorkspaceSettings(prisma, info.workspaceId) : null,
  ]);
  const account = wanted ? rows.find((r) => r.dns?.domain === wanted) : undefined;
  const count = (s: (typeof rows)[number]["status"]) => rows.filter((r) => r.status === s).length;
  const attention = count("Needs Attention");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Deliverability"
        description="Warm-up and re-warm-up cannot guarantee inbox placement. Health is an internal indicator, not a reputation guarantee."
        tabs={<SectionTabs tabs={DELIVERABILITY_TABS} />}
      />
      <Callout tone="neutral" title="Recommended limits" className="max-w-3xl">
        <ul className="list-disc pl-4">
          <li>Recommended: about 30 campaign emails and 10 warm-up emails per account and day.</li>
          <li>
            Warm a new account for at least two weeks before full volume; four weeks is safer for a
            new domain.
          </li>
          <li>
            Warm-up knobs: reply rate is a cooperative-mailbox action. Read emulation, open rate,
            spam protection and mark important are not provided.
          </li>
        </ul>
      </Callout>
      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Accounts sending" value={String(count("Active"))} of={rows.length} />
          <StatTile
            label="Needs attention"
            value={String(attention)}
            className={attention > 0 ? "stripe-danger" : undefined}
          />
          <StatTile label="Re-warming" value={String(count("Re-Warming"))} />
          <StatTile
            label="DNS issues"
            value={String(rows.filter((r) => r.dns && r.dns.level !== "ok").length)}
          />
        </div>
      )}
      <DeliverabilityTable rows={rows} canEdit={info.role !== "VIEWER"} />
      <HealthFormula />
      {/* the DNS chip links here; only a domain of one of the accounts above is shown */}
      {account && (
        <Card id="dns" className="max-w-3xl scroll-mt-16">
          <DomainSection email={account.email} canEdit={info.role !== "VIEWER"} />
        </Card>
      )}
      {settings && <DeliverabilitySettings {...settings} />}
    </div>
  );
}
