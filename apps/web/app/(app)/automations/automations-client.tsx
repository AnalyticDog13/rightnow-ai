"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs } from "../../../components/tabs";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Label } from "../../../components/ui/label";
import { call, errorText } from "../accounts/api-client";
import { RuleEditor } from "./rule-editor";
import { WebhooksTab, type Hook } from "./webhooks-tab";
import { ACTION_TYPES, TRIGGERS, type Refs, type Rule } from "./rule-meta";
import { Err, Head, sel } from "./ui";

type Builtin = {
  key: string;
  trigger: string;
  actions: string[];
  locked: boolean;
  reason: string;
  settingsHref?: string;
  enabled: boolean;
};
type Run = {
  id: string;
  eventId: string;
  status: "OK" | "FAILED" | "SKIPPED";
  error: string | null;
  createdAt: string;
};
const humanize = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replaceAll("_", " ");
const actionLabel = (t: string) => ACTION_TYPES[t]?.label ?? humanize(t);

function RulesTab({
  refs,
  canEdit,
  rules,
  reload,
}: {
  refs: Refs;
  canEdit: boolean;
  rules: Rule[] | null;
  reload: () => void;
}) {
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [error, setError] = useState("");

  // one request per rule at a time, so a double click cannot race
  const [busy, setBusy] = useState<string | null>(null);
  async function act(r: Rule, method: "PATCH" | "DELETE", body?: unknown) {
    if (method === "DELETE" && !confirm(`Delete rule ${r.name}? Its run history is deleted too.`))
      return;
    setBusy(r.id);
    const res = await call(`/api/v1/automations/rules/${r.id}`, method, body);
    setBusy(null);
    setError(res.ok ? "" : errorText(res));
    reload();
  }

  if (editing)
    return (
      <RuleEditor
        rule={editing === "new" ? null : editing}
        refs={refs}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    );
  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div>
          <Button onClick={() => setEditing("new")}>New rule</Button>
        </div>
      )}
      <Err text={error} />
      {rules && !rules.length && <p className="text-sm text-muted-foreground">No rules yet.</p>}
      {!!rules?.length && (
        <Card className="overflow-x-auto p-0">
          <table aria-label="Rules" className="w-full text-left text-sm">
            <Head cols={["Name", "When", "Then", "Enabled", "Actions"]} />
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3">{TRIGGERS[r.trigger] ?? r.trigger}</td>
                  <td className="p-3">{r.actions.map((a) => actionLabel(a.type)).join(", ")}</td>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`Enable ${r.name}`}
                      checked={r.enabled}
                      disabled={!canEdit || busy === r.id}
                      onChange={(e) => void act(r, "PATCH", { enabled: e.target.checked })}
                    />
                  </td>
                  <td className="flex gap-2 p-3">
                    <Button
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      aria-label={`Edit ${r.name}`}
                      disabled={!canEdit}
                      onClick={() => setEditing(r)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      aria-label={`Delete ${r.name}`}
                      disabled={!canEdit}
                      onClick={() => void act(r, "DELETE")}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function BuiltinTab({ isAdmin }: { isAdmin: boolean }) {
  const [list, setList] = useState<Builtin[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await call("/api/v1/automations/builtin", "GET");
    if (!r.ok) return setError(errorText(r));
    setList(r.json.builtin as Builtin[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function toggle(b: Builtin, enabled: boolean) {
    const r = await call(`/api/v1/automations/builtin/${b.key}`, "PATCH", { enabled });
    setError(r.ok ? "" : errorText(r));
    void load();
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        These already run inside the app. Only the ones that are not locked can be switched off, by
        an admin.
      </p>
      <Err text={error} />
      <ul aria-label="Built-in rules" className="flex flex-col gap-2">
        {list?.map((b) => (
          <li
            key={b.key}
            className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{humanize(b.key)}</span>
              <span className="text-muted-foreground">
                {TRIGGERS[b.trigger] ?? b.trigger}
                {b.actions.length ? `: ${b.actions.map(actionLabel).join(", ")}` : ""}
              </span>
              {b.locked ? (
                <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-xs">
                  Locked
                </span>
              ) : (
                <label className="ml-auto flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={b.enabled}
                    disabled={!isAdmin}
                    onChange={(e) => void toggle(b, e.target.checked)}
                  />
                  Enabled
                </label>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {b.reason}{" "}
              {b.settingsHref && (
                <Link href={b.settingsHref} className="underline">
                  Settings
                </Link>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunsTab({ rules }: { rules: Rule[] | null }) {
  const [ruleId, setRuleId] = useState("");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const id = ruleId || rules?.[0]?.id || "";
  const current = useRef(id);

  const load = useCallback(
    async (cursor?: string) => {
      if (!id) return;
      const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const r = await call(`/api/v1/automations/rules/${id}/runs${q}`, "GET");
      if (id !== current.current) return; // the selection moved on
      if (!r.ok) return setError(errorText(r));
      setError("");
      setRuns((old) => [...(cursor ? (old ?? []) : []), ...(r.json.runs as Run[])]);
      setNext(r.json.nextCursor as string | null);
    },
    [id],
  );
  useEffect(() => {
    current.current = id;
    setRuns(null);
    setNext(null);
    void load();
  }, [id, load]);

  if (rules && !rules.length)
    return <p className="text-sm text-muted-foreground">No rules yet, so nothing has run.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="runs-rule">Rule</Label>
        <select
          id="runs-rule"
          className={`${sel} w-64`}
          value={id}
          onChange={(e) => setRuleId(e.target.value)}
        >
          {rules?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <Err text={error} />
      {runs && !runs.length && (
        <p className="text-sm text-muted-foreground">This rule has not run yet.</p>
      )}
      {!!runs?.length && (
        <Card className="overflow-x-auto p-0">
          <table aria-label="Runs" className="w-full text-left text-sm">
            <Head cols={["Time", "Event", "Result"]} />
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="p-3">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="p-3 font-mono text-xs">{r.eventId}</td>
                  <td className="p-3">
                    {r.status}
                    {r.error && <span className="text-muted-foreground"> ({r.error})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {next && (
        <div>
          <Button variant="outline" onClick={() => void load(next)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

export function AutomationsClient({
  refs,
  canEdit,
  isAdmin,
  events,
  labels,
}: {
  refs: Omit<Refs, "webhooks">;
  canEdit: boolean;
  isAdmin: boolean;
  /** Standard webhook event names and the workspace's label names (both can be subscribed to). */
  events: string[];
  labels: string[];
}) {
  const sp = useSearchParams();
  const first = sp.get("tab");
  const [tab, setTab] = useState(
    first === "builtin" || first === "runs" || first === "webhooks" ? first : "rules",
  );
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const r = await call("/api/v1/automations/rules", "GET");
    if (!r.ok) return setError(errorText(r));
    setRules(r.json.rules as Rule[]);
  }, []);
  const reloadHooks = useCallback(async () => {
    const r = await call("/api/v1/webhooks", "GET");
    if (!r.ok) return setError(errorText(r));
    setHooks(r.json.webhooks as Hook[]);
  }, []);
  useEffect(() => {
    void reload();
    void reloadHooks();
  }, [reload, reloadHooks]);
  const allRefs = {
    ...refs,
    webhooks: (hooks ?? []).map((h) => ({ id: h.id, name: h.name || h.url })),
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
      <Err text={error} />
      <Tabs
        label="Automation views"
        tabs={[
          { id: "rules", label: "Rules" },
          { id: "builtin", label: "Built-in" },
          { id: "runs", label: "Runs" },
          { id: "webhooks", label: "Webhooks" },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === "rules" && (
          <RulesTab refs={allRefs} canEdit={canEdit} rules={rules} reload={() => void reload()} />
        )}
        {tab === "builtin" && <BuiltinTab isAdmin={isAdmin} />}
        {tab === "runs" && <RunsTab rules={rules} />}
        {tab === "webhooks" && (
          <WebhooksTab
            hooks={hooks}
            reload={() => void reloadHooks()}
            canEdit={canEdit}
            campaigns={refs.campaigns}
            events={events}
            labels={labels}
          />
        )}
      </Tabs>
    </div>
  );
}
