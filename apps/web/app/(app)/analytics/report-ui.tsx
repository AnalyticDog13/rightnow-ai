import type { Metrics } from "@rightnow/core";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui/button";
import { csvText } from "./query";
import type { Row } from "./metrics-def";

export type Report = { total: Metrics; rows: Row[] };
export type Acct = {
  id: string;
  email: string;
  sent: number;
  contacted: number;
  opened: number;
  replied: number;
  replyRate: number | null;
  healthScore: number | null;
  trend: { day: string; score: number }[];
  remainingToday: number;
};
export type Bounces = {
  hard: number;
  soft: number;
  unknown: number;
  reasons: { type: string; reason: string; count: number }[];
};
export type Revenue = {
  pipelineValue: string;
  openCount: number;
  avgDealSize: string | null;
  wonValue: string;
  cashCollected: string;
  annualizedClosed: string;
  revenuePerLead: string | null;
  conversionByStage: { stageId: string; name: string; count: number; reachedPct: number | null }[];
  revenueByCampaign: {
    campaignId: string | null;
    name: string;
    won: number;
    cashCollected: string;
  }[];
};
export type Data = {
  campaign: Report;
  step: Report;
  variant: Report;
  day: Report;
  accounts: Acct[];
  bounces: Bounces;
  revenue: Revenue;
};
export type VariantInfo = { campaignId: string; stepId: string; active: boolean };

export const KEY = "analytics.hiddenMetrics";
export const API = "/api/v1/analytics";
export const th = "px-2 py-1 text-left font-medium";
export const td = "px-2 py-1 tabular-nums";
export const note = "text-xs text-muted-foreground";

export function download(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = `s-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-medium">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const CsvFile = ({ name, rows }: { name: string; rows: unknown[][] }) => (
  <Button variant="outline" onClick={() => download(name, rows)}>
    Download CSV
  </Button>
);

export function Table({
  caption,
  heads,
  children,
}: {
  caption: string;
  heads: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted">
          <tr>
            {heads.map((h, i) => (
              <th key={i} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
