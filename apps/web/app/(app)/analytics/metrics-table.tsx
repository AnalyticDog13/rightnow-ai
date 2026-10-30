import type { Metrics } from "@rightnow/core";
import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { pct } from "../../../components/stat-tile";
import { Button } from "../../../components/ui/button";
import { CONTACTED_NOTE, METRICS, type Row, SENT_TIP } from "./metrics-def";
import { API, type Report, Section, Table, note, td, th } from "./report-ui";

/** One metrics table (campaigns, steps, variants, days) with its total row and CSV. */
export function MetricsTable({
  title,
  r,
  by,
  perGroup,
  extra,
  shown,
  base,
  query,
}: {
  shown: typeof METRICS;
  base: string;
  query: (groupBy?: string) => URLSearchParams;
  title: string;
  r: Report;
  by: string;
  perGroup?: boolean;
  extra?: { head: string; cell: (row: Row) => ReactNode };
}) {
  const b = perGroup ? (base === "sent" ? "sent" : "leads sent") : base;
  const cell = (m: Metrics, d: (typeof METRICS)[number]) => {
    const rate = d.rate?.(m, b);
    return (
      <td key={d.id} className={`${td} text-right whitespace-nowrap`}>
        {/* the tooltip is for the mouse; screen readers get the same words once, from the sr-only span */}
        <span aria-hidden={rate ? true : undefined} title={rate?.tip} className="flex flex-col">
          {rate ? (
            <>
              <span>{pct(rate.value)}</span>
              <span className="text-[13px]/[18px] text-fg-subtle">{d.count(m)}</span>
            </>
          ) : (
            d.count(m)
          )}
        </span>
        {rate && (
          <span className="sr-only">
            {d.count(m)} ({pct(rate.value)}) {rate.tip}
          </span>
        )}
      </td>
    );
  };
  return (
    <Section
      title={title}
      action={
        <Button asChild variant="outline" size="sm">
          <a href={`${API}?${query(by)}&format=csv`} download>
            <Download aria-hidden />
            Download CSV
          </a>
        </Button>
      }
    >
      <Table
        caption={title}
        heads={[
          "Name",
          ...(extra ? [extra.head] : []),
          ...shown.map((d) => (
            <span
              key={d.id}
              title={d.id === "sent" ? SENT_TIP : d.id === "contacted" ? CONTACTED_NOTE : undefined}
            >
              {d.label}
            </span>
          )),
        ]}
      >
        {/* B5.13: the totals row first, on the sunken background */}
        <tr className="bg-sunken font-medium [&>td]:bg-sunken">
          <th scope="row" className={th}>
            Total
          </th>
          {extra && <td />}
          {shown.map((d) => cell(r.total, d))}
        </tr>
        {r.rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" className={`${th} max-w-64 font-normal`}>
              {row.label}
            </th>
            {extra && <td className="text-right">{extra.cell(row)}</td>}
            {shown.map((d) => cell(row, d))}
          </tr>
        ))}
      </Table>
      <p className={note}>{CONTACTED_NOTE}</p>
    </Section>
  );
}
