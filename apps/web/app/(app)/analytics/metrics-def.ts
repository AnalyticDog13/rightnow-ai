import type { Metrics } from "@rightnow/core";
import { rateTip } from "./query";

export type Row = Metrics & { key: string; label: string };
type Rate = { label: string; value: number | null; tip: string };
type Def = {
  id: string;
  label: string;
  count: (m: Metrics) => number;
  rate?: (m: Metrics, base: string) => Rate;
};

export const SENT_TIP = "Accepted by the provider (not proof of delivery)";
export const OPEN_TIP = "Estimated: pixel-based, machine opens excluded";
/** Shown wherever a total sits next to rows (Contacted is counted per row). */
export const CONTACTED_NOTE =
  "Contacted counts each lead once per row. A lead first mailed by two campaigns in this range appears in both rows, so the rows can add up to more than the total.";

/** The metrics the tiles and tables show; the gear menu hides any of them. */
export const METRICS: Def[] = [
  { id: "sent", label: "Sent", count: (m) => m.sent },
  { id: "contacted", label: "Contacted", count: (m) => m.contacted },
  {
    id: "opened",
    label: "Opened",
    count: (m) => m.opened,
    rate: (m, base) => ({
      label: "Estimated open rate",
      value: m.rates.open,
      tip: `${rateTip(m.opened, m.rateBase, base)}. ${OPEN_TIP}`,
    }),
  },
  {
    id: "clicked",
    label: "Clicked",
    count: (m) => m.clicked,
    rate: (m) => ({
      label: "click rate",
      value: m.rates.click,
      tip: rateTip(m.clickedSends, m.sent, "sent"),
    }),
  },
  {
    id: "replied",
    label: "Replied",
    count: (m) => m.replied,
    rate: (m, base) => ({
      label: "reply rate",
      value: m.rates.reply,
      tip: rateTip(m.replied, m.rateBase, base),
    }),
  },
  {
    id: "positive",
    label: "Positive replies",
    count: (m) => m.opportunities,
    rate: (m) => ({
      label: "of replies",
      value: m.rates.positiveReply,
      tip: rateTip(m.opportunities, m.replied, "replied leads"),
    }),
  },
  {
    id: "bounced",
    label: "Bounced",
    count: (m) => m.hardBounced,
    rate: (m) => ({
      label: "bounce rate",
      value: m.rates.bounce,
      tip: rateTip(m.hardBounced, m.sent, "sent"),
    }),
  },
  { id: "unsubscribed", label: "Unsubscribed", count: (m) => m.unsubscribed },
  { id: "meetings", label: "Meetings", count: (m) => m.meetings },
  { id: "won", label: "Won (campaign deals)", count: (m) => m.won },
];
