"use client";

import { GitBranch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../../../../components/empty-state";
import { StatusPill } from "../../../../components/status-pill";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Select } from "../../../../components/ui/select";
import { Switch } from "../../../../components/ui/switch";
import { call, errorText } from "../../accounts/api-client";
import { StepsEditor, type Step } from "./sequences-tab";

type Sub = {
  id: string;
  name: string;
  active: boolean;
  trigger: { kind: string; interest?: number[]; activity?: string; phrases?: string[] };
  steps: Step[];
};
// What a user can pick; each maps to one trigger the API accepts.
const TRIGGERS: Record<string, { label: string; build: (words: string) => object }> = {
  interested: {
    label: "Lead is marked Interested",
    build: () => ({ kind: "LEAD_STATUS", interest: [1] }),
  },
  no_reply: {
    label: "Sequence finished with no reply",
    build: () => ({ kind: "ACTIVITY", activity: "completed_no_reply" }),
  },
  opened: {
    label: "Lead opened an email",
    build: () => ({ kind: "ACTIVITY", activity: "opened" }),
  },
  clicked: {
    label: "Lead clicked a link",
    build: () => ({ kind: "ACTIVITY", activity: "clicked" }),
  },
  keyword: {
    label: "Reply contains a phrase",
    build: (w) => ({
      kind: "REPLY_KEYWORD",
      phrases: w
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    }),
  },
};
const describe = (t: Sub["trigger"]) =>
  t.kind === "LEAD_STATUS"
    ? "Lead status changes"
    : t.kind === "ACTIVITY"
      ? `Lead activity: ${t.activity?.replaceAll("_", " ")}`
      : `Reply contains: ${t.phrases?.join(", ")}`;

/** PS-CAMP-03: only offered once the campaign has launched. */
export function SubsequencesTab(c: {
  campaignId: string;
  variables: string[];
  canEdit: boolean;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("interested");
  const [words, setWords] = useState("");
  const [msg, setMsg] = useState("");
  const reload = useCallback(async () => {
    const r = await call(`/api/v1/campaigns/${c.campaignId}/steps`, "GET");
    if (r.ok) setSubs(r.json.subsequences as Sub[]);
  }, [c.campaignId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function act(r: ReturnType<typeof call>) {
    const res = await r;
    setMsg(res.ok ? "" : errorText(res));
    if (res.ok) {
      setName("");
      void reload();
      c.onChange();
    }
  }
  if (!subs)
    return (
      <p role="status" className="text-sm text-fg-muted">
        Loading...
      </p>
    );

  return (
    <div className="flex flex-col gap-4">
      {c.canEdit && (
        <Card>
          <form
            className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                call(`/api/v1/campaigns/${c.campaignId}/subsequences`, "POST", {
                  name,
                  trigger: TRIGGERS[kind]!.build(words),
                }),
              );
            }}
          >
            <Input
              aria-label="New subsequence name"
              placeholder="Subsequence name"
              className="md:w-60"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Select
              aria-label="Trigger"
              className="md:w-72"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {Object.entries(TRIGGERS).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </Select>
            {kind === "keyword" && (
              <Input
                aria-label="Phrases (comma separated)"
                placeholder="Phrases, comma separated"
                className="md:w-60"
                value={words}
                onChange={(e) => setWords(e.target.value)}
              />
            )}
            <Button type="submit" disabled={!name.trim()}>
              Create subsequence
            </Button>
          </form>
        </Card>
      )}
      {msg && (
        <p role="alert" className="text-sm text-danger">
          {msg}
        </p>
      )}
      {subs.map((s) => (
        <Card key={s.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {s.name}
                <StatusPill tone={s.active ? "info" : "neutral"} icon={GitBranch}>
                  {s.active ? "Running" : "Off"}
                </StatusPill>
              </h3>
              <p className="text-[13px]/[18px] text-fg-muted">
                When: {describe(s.trigger)} · {s.steps.length} step
                {s.steps.length === 1 ? "" : "s"}
              </p>
            </div>
            <Switch
              label="Active"
              disabled={!c.canEdit}
              checked={s.active}
              onChange={(e) =>
                void act(
                  call(`/api/v1/campaigns/${c.campaignId}/subsequences/${s.id}`, "PATCH", {
                    active: e.target.checked,
                  }),
                )
              }
            />
          </div>
          <StepsEditor {...c} steps={s.steps} subsequenceId={s.id} reload={() => void reload()} />
        </Card>
      ))}
      {subs.length === 0 && (
        <Card className="p-0 md:p-0">
          <EmptyState
            icon={GitBranch}
            title="No subsequences yet."
            body="A subsequence sends its own steps when a lead matches its trigger."
          />
        </Card>
      )}
    </div>
  );
}
