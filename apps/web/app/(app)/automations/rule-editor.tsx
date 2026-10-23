"use client";

import { useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call, errorText } from "../accounts/api-client";
import type { Member, Named } from "../leads/bulk-bar";
import { INTEREST } from "../leads/labels";

export const TRIGGERS: Record<string, string> = {
  reply_received: "Reply received",
  positive_reply: "Positive reply",
  negative_reply: "Negative reply",
  status_changed: "Lead status changed",
  label_added: "Label added",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  campaign_completed: "Campaign completed",
  account_error: "Mailbox error",
  send_failure_threshold: "Send failure threshold",
  quota_reached: "Daily limit reached",
  deal_won: "Deal won",
  deal_lost: "Deal lost",
};

type Source = "campaigns" | "lists" | "subsequences" | "members";
type Field = {
  key: string;
  label: string;
  kind: "text" | "number" | "select" | "check";
  source?: Source;
  required?: boolean;
};
export const ACTION_TYPES: Record<string, { label: string; fields: Field[] }> = {
  create_task: {
    label: "Create task",
    fields: [
      { key: "title", label: "Title", kind: "text", required: true },
      { key: "dueInDays", label: "Due in days", kind: "number" },
      { key: "assigneeId", label: "Assignee", kind: "select", source: "members" },
    ],
  },
  create_opportunity: { label: "Create opportunity", fields: [] },
  stop_sequence: {
    label: "Stop sequence",
    fields: [
      { key: "campaignId", label: "Only this campaign", kind: "select", source: "campaigns" },
    ],
  },
  suppress_contact: { label: "Suppress contact", fields: [] },
  pause_account: {
    label: "Pause mailbox",
    fields: [{ key: "until", label: "Until next day", kind: "check" }],
  },
  add_to_list: {
    label: "Add to list",
    fields: [{ key: "listId", label: "List", kind: "select", source: "lists", required: true }],
  },
  enroll_campaign: {
    label: "Enroll in campaign",
    fields: [
      { key: "campaignId", label: "Campaign", kind: "select", source: "campaigns", required: true },
    ],
  },
  move_to_subsequence: {
    label: "Move to subsequence",
    fields: [
      {
        key: "subsequenceId",
        label: "Subsequence",
        kind: "select",
        source: "subsequences",
        required: true,
      },
    ],
  },
  assign_owner: {
    label: "Assign owner",
    fields: [{ key: "userId", label: "Owner", kind: "select", source: "members", required: true }],
  },
  add_tag: {
    label: "Add tag",
    fields: [{ key: "tag", label: "Tag", kind: "text", required: true }],
  },
};

export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  conditions: {
    campaignIds?: string[];
    accountIds?: string[];
    leadTags?: string[];
    interestCodes?: number[];
    labels?: string[];
  };
  actions: ({ type: string } & Record<string, unknown>)[];
};
export type Refs = {
  campaigns: Named[];
  lists: Named[];
  subsequences: Named[];
  members: Member[];
  accounts: Named[];
};

const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";
const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Per-action field values are edited as strings and converted on save. */
type Draft = { type: string; v: Record<string, string> };
const toDraft = (a: Rule["actions"][number]): Draft => ({
  type: a.type,
  v: Object.fromEntries(
    Object.entries(a)
      .filter(([k]) => k !== "type")
      .map(([k, x]) => [k, x === "next_day" ? "1" : String(x)]),
  ),
});
function toAction({ type, v }: Draft) {
  const out: Record<string, unknown> = { type };
  for (const f of ACTION_TYPES[type]!.fields) {
    const x = v[f.key];
    if (!x) continue;
    out[f.key] = f.kind === "number" ? Number(x) : f.kind === "check" ? "next_day" : x;
  }
  return out;
}

export function RuleEditor({
  rule,
  refs,
  onSaved,
  onCancel,
}: {
  rule: Rule | null;
  refs: Refs;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const c = rule?.conditions ?? {};
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState(rule?.trigger ?? "reply_received");
  const [campaignIds, setCampaignIds] = useState(c.campaignIds ?? []);
  const [accountIds, setAccountIds] = useState(c.accountIds ?? []);
  const [codes, setCodes] = useState(c.interestCodes ?? []);
  const [tags, setTags] = useState((c.leadTags ?? []).join(", "));
  const [labels, setLabels] = useState((c.labels ?? []).join(", "));
  const [actions, setActions] = useState<Draft[]>(
    rule ? rule.actions.map(toDraft) : [{ type: "create_task", v: {} }],
  );
  const [error, setError] = useState("");

  const patchAction = (i: number, d: Partial<Draft>) =>
    setActions((a) => a.map((x, j) => (j === i ? { ...x, ...d } : x)));
  const move = (i: number, by: number) =>
    setActions((a) => {
      const n = [...a];
      [n[i], n[i + by]] = [n[i + by]!, n[i]!];
      return n;
    });
  const toggle = <T,>(set: (f: (s: T[]) => T[]) => void, x: T) =>
    set((s) => (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]));

  async function save(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: name.trim(),
      trigger,
      conditions: {
        ...(campaignIds.length && { campaignIds }),
        ...(accountIds.length && { accountIds }),
        ...(csv(tags).length && { leadTags: csv(tags) }),
        ...(csv(labels).length && { labels: csv(labels) }),
        ...(codes.length && { interestCodes: codes }),
      },
      actions: actions.map(toAction),
    };
    const r = await call(
      rule ? `/api/v1/automations/rules/${rule.id}` : "/api/v1/automations/rules",
      rule ? "PATCH" : "POST",
      body,
    );
    if (!r.ok) return setError(errorText(r));
    onSaved();
  }

  const options = (s: Source) =>
    s === "members" ? refs.members.map((m) => ({ id: m.userId, name: m.name })) : refs[s];

  return (
    <Card>
      <form
        onSubmit={save}
        className="flex flex-col gap-4"
        aria-label={rule ? "Edit rule" : "New rule"}
      >
        <h2 className="text-lg font-medium">{rule ? "Edit rule" : "New rule"}</h2>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-trigger">When</Label>
            <select
              id="rule-trigger"
              className={sel}
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
            >
              {Object.entries(TRIGGERS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Only if (leave empty for any)</legend>
          <Checks
            legend="Campaigns"
            items={refs.campaigns}
            on={campaignIds}
            toggle={(id) => toggle(setCampaignIds, id)}
          />
          <Checks
            legend="Mailboxes"
            items={refs.accounts}
            on={accountIds}
            toggle={(id) => toggle(setAccountIds, id)}
          />
          <div
            role="group"
            aria-label="Lead status"
            className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
          >
            {Object.entries(INTEREST).map(([code, label]) => (
              <label key={code} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={codes.includes(Number(code))}
                  onChange={() => toggle(setCodes, Number(code))}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-tags">Lead has tags (comma separated)</Label>
              <Input id="rule-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-labels">Label is (comma separated)</Label>
              <Input id="rule-labels" value={labels} onChange={(e) => setLabels(e.target.value)} />
            </div>
          </div>
        </fieldset>

        <ol aria-label="Actions" className="flex flex-col gap-3">
          {actions.map((a, i) => (
            <li key={i}>
              <fieldset
                aria-label={`Action ${i + 1}`}
                className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3"
              >
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`act-type-${i}`}>Then {i + 1}</Label>
                  <select
                    id={`act-type-${i}`}
                    className={sel}
                    value={a.type}
                    onChange={(e) => patchAction(i, { type: e.target.value, v: {} })}
                  >
                    {Object.entries(ACTION_TYPES).map(([k, t]) => (
                      <option key={k} value={k}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                {ACTION_TYPES[a.type]!.fields.map((f) => {
                  const id = `act-${i}-${f.key}`;
                  const set = (x: string) => patchAction(i, { v: { ...a.v, [f.key]: x } });
                  return f.kind === "check" ? (
                    <label key={f.key} className="flex items-center gap-1 pb-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!a.v[f.key]}
                        onChange={(e) => set(e.target.checked ? "1" : "")}
                      />
                      {f.label}
                    </label>
                  ) : (
                    <div key={f.key} className="flex flex-col gap-1">
                      <Label htmlFor={id}>{f.label}</Label>
                      {f.kind === "select" ? (
                        <select
                          id={id}
                          className={sel}
                          required={f.required}
                          value={a.v[f.key] ?? ""}
                          onChange={(e) => set(e.target.value)}
                        >
                          <option value="">{f.required ? "Choose" : "Any"}</option>
                          {options(f.source!).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={id}
                          type={f.kind}
                          min={f.kind === "number" ? 0 : undefined}
                          required={f.required}
                          value={a.v[f.key] ?? ""}
                          onChange={(e) => set(e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
                <div className="ml-auto flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Move action ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Move action ${i + 1} down`}
                    disabled={i === actions.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    Down
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Remove action ${i + 1}`}
                    disabled={actions.length === 1}
                    onClick={() => setActions((x) => x.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              </fieldset>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={actions.length >= 10}
            onClick={() => setActions((a) => [...a, { type: "create_task", v: {} }])}
          >
            Add action
          </Button>
          <Button type="submit">Save rule</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Checks({
  legend,
  items,
  on,
  toggle,
}: {
  legend: string;
  items: Named[];
  on: string[];
  toggle: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div role="group" aria-label={legend} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map((i) => (
        <label key={i.id} className="flex items-center gap-1">
          <input type="checkbox" checked={on.includes(i.id)} onChange={() => toggle(i.id)} />
          {i.name}
        </label>
      ))}
    </div>
  );
}
