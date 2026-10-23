export type Opp = {
  id: string;
  lead: { id: string; email: string; companyName: string | null };
  campaign: { id: string; name: string } | null;
  stageId: string;
  title: string;
  value: string;
  cashCollected: string;
  expectedCloseAt: string | null;
  ownerId: string | null;
  closedAt: string | null;
  stepId: string | null;
  variantId: string | null;
  accountId: string | null;
  createdAt: string;
};
export type Kind = "OPEN" | "WON" | "LOST";
export type Column = {
  id: string;
  name: string;
  kind: Kind;
  count: number;
  value: string;
  opportunities: Opp[];
  more: boolean;
};
export type BoardData = { currency: string; stages: Column[] };
export type StageOption = { id: string; name: string; kind: Kind };

export const money = (currency: string, v: string | number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));

/** Backend error codes that a person can act on. */
const ERRORS: Record<string, string> = {
  interest_code_taken: "Another stage already uses one of those interest statuses.",
  last_stage_of_kind: "The pipeline needs at least one open, one won and one lost stage.",
  too_many_stages: "A pipeline can have at most 20 stages.",
  stage_not_empty: "That stage still holds deals.",
  move_kind_mismatch: "Deals can only move to a stage of the same kind.",
  stage_exists: "A stage with that name already exists.",
  opportunity_exists: "That lead already has an opportunity for this campaign.",
  currency_in_use: "The currency cannot change while a deal has a value or cash collected.",
  invalid_currency: "Use a three-letter currency code such as USD.",
};
export const friendly = (r: { json: Record<string, unknown> }) =>
  typeof r.json.error === "string"
    ? (ERRORS[r.json.error] ?? r.json.error)
    : "Something went wrong";
