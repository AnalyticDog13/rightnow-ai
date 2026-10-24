import { pct, StatTile } from "../../../components/stat-tile";
import { CONTACTED_NOTE } from "./metrics-def";
import { rateTip } from "./query";
import {
  CsvFile,
  type Acct,
  type Bounces,
  type Revenue,
  Section,
  Table,
  note,
  td,
  th,
} from "./report-ui";

export function AccountsSection({ accounts }: { accounts: Acct[] }) {
  return (
    <Section
      title="Email accounts"
      action={
        <CsvFile
          name="accounts.csv"
          rows={[
            [
              "account",
              "sent",
              "contacted",
              "opened",
              "replied",
              "reply_rate",
              "health",
              "remaining_today",
            ],
            ...accounts.map((a) => [
              a.email,
              a.sent,
              a.contacted,
              a.opened,
              a.replied,
              a.replyRate,
              a.healthScore,
              a.remainingToday,
            ]),
          ]}
        />
      }
    >
      <Table
        caption="Email accounts"
        heads={[
          "Account",
          "Sent",
          <span key="c" title={CONTACTED_NOTE}>
            Contacted
          </span>,
          "Opened",
          "Replied",
          "Reply rate",
          "Health",
          "Health trend",
          "Remaining today",
        ]}
      >
        {accounts.map((a) => (
          <tr key={a.id} className="border-t border-border">
            <th scope="row" className={`${th} font-normal`}>
              {a.email}
            </th>
            <td className={td}>{a.sent}</td>
            <td className={td}>{a.contacted}</td>
            <td className={td}>{a.opened}</td>
            <td className={td}>{a.replied}</td>
            <td className={td} title={rateTip(a.replied, a.sent, "sent")}>
              {pct(a.replyRate)}
            </td>
            <td className={td}>{a.healthScore ?? "n/a"}</td>
            <td className={td} title={a.trend.map((t) => `${t.day}: ${t.score}`).join(", ")}>
              {a.trend.length > 1 ? `${a.trend[0]!.score} to ${a.trend.at(-1)!.score}` : "n/a"}
            </td>
            <td className={td}>{a.remainingToday}</td>
          </tr>
        ))}
      </Table>
      <p className={note}>{CONTACTED_NOTE}</p>
    </Section>
  );
}

export function BouncesSection({ bounces }: { bounces: Bounces }) {
  return (
    <Section
      title="Bounces"
      action={
        <CsvFile
          name="bounces.csv"
          rows={[
            ["type", "reason", "count"],
            ...bounces.reasons.map((x) => [x.type, x.reason, x.count]),
          ]}
        />
      }
    >
      <p className="text-sm">
        Hard {bounces.hard}, soft {bounces.soft}, unknown {bounces.unknown} leads.
      </p>
      <Table caption="Top bounce and failure reasons" heads={["Type", "Reason", "Count"]}>
        {bounces.reasons.map((x) => (
          <tr key={`${x.type}${x.reason}`} className="border-t border-border">
            <td className={td}>{x.type}</td>
            <td className={td}>{x.reason}</td>
            <td className={td}>{x.count}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

export function RevenueSection({
  revenue,
  money,
}: {
  revenue: Revenue;
  money: (v: string | null) => string;
}) {
  return (
    <Section
      title="Revenue"
      action={
        <CsvFile
          name="revenue.csv"
          rows={[
            ["campaign", "won", "cash_collected"],
            ...revenue.revenueByCampaign.map((x) => [x.name, x.won, x.cashCollected]),
          ]}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Pipeline (current)"
          value={money(revenue.pipelineValue)}
          note={`${revenue.openCount} open deals`}
        />
        <StatTile label="Average deal size" value={money(revenue.avgDealSize)} />
        <StatTile label="Won in range (all deals)" value={money(revenue.wonValue)} />
        <StatTile label="Cash collected (all deals)" value={money(revenue.cashCollected)} />
        <StatTile label="Annualized closed" value={money(revenue.annualizedClosed)} />
        <StatTile
          label="Revenue per lead"
          value={money(revenue.revenuePerLead)}
          note="Campaign-deal cash / contacted"
        />
      </div>
      <Table
        caption="Conversion by current stage"
        heads={["Conversion by current stage", "Deals", "Reached"]}
      >
        {revenue.conversionByStage.map((s) => (
          <tr key={s.stageId} className="border-t border-border">
            <th scope="row" className={`${th} font-normal`}>
              {s.name}
            </th>
            <td className={td}>{s.count}</td>
            <td className={td}>{pct(s.reachedPct)}</td>
          </tr>
        ))}
      </Table>
      <Table caption="Revenue by campaign" heads={["Campaign", "Won", "Cash collected"]}>
        {revenue.revenueByCampaign.map((c) => (
          <tr key={c.campaignId ?? "none"} className="border-t border-border">
            <th scope="row" className={`${th} font-normal`}>
              {c.name}
            </th>
            <td className={td}>{c.won}</td>
            <td className={td}>{money(c.cashCollected)}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}
