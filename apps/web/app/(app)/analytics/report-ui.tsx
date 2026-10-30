import type { Metrics } from "@rightnow/core";
import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { TableFrame } from "../../../components/table-kit";
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
/** Header cells get the B4.6 micro look from TableFrame; `th` is for row headers, which read as body text. */
export const th =
  "static h-11 border-b border-border bg-transparent py-2 text-left font-sans text-sm font-medium tracking-normal whitespace-normal text-fg normal-case";
export const td = "text-right tabular-nums";
export const note = "text-[13px]/[18px] text-fg-subtle";

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
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const CsvFile = ({ name, rows }: { name: string; rows: unknown[][] }) => (
  <Button variant="outline" size="sm" onClick={() => download(name, rows)}>
    <Download aria-hidden />
    Download CSV
  </Button>
);

export function Table({
  caption,
  heads,
  left = 1,
  children,
}: {
  caption: string;
  heads: ReactNode[];
  /** leading text columns; the rest are numbers, right-aligned */
  left?: number;
  children: ReactNode;
}) {
  return (
    <TableFrame>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {heads.map((h, i) => (
              <th key={i} scope="col" className={i >= left ? "text-right" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </TableFrame>
  );
}
