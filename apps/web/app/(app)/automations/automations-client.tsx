"use client";

import { Lock, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState } from "../../../components/empty-state";
import { useInlineEditor } from "../../../components/inline-editor";
import { PageHeader } from "../../../components/page-header";
import { pillFor, RUN_STATUS, StatusPill } from "../../../components/status-pill";
import { TableEmpty, TableFrame } from "../../../components/table-kit";
import { Tabs } from "../../../components/tabs";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/utils";
import { call, errorText } from "../accounts/api-client";
import { INTEREST } from "../leads/labels";
import { RuleEditor } from "./rule-editor";
import { ACTION_TYPES, TRIGGERS, type Refs, type Rule } from "./rule-meta";
import { Err, Head } from "./ui";
import { WebhooksTab, type Hook } from "./webhooks-tab";

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
type Editor<T> = ReturnType<typeof useInlineEditor<T>>;
const humanize = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replaceAll("_", " ");
const actionLabel = (t: string) => ACTION_TYPES[t]?.label ?? humanize(t);
const RUN_LABEL = { OK: "OK", FAILED: "Failed", SKIPPED: "Skipped" } as const;

/** B4.22: the rule as a sentence, bold parts in fg, connectors muted. */
function Sentence({ r, refs }: { r: Rule; refs: Refs }) {
  const c = r.conditions;
  const names = (ids: string[] | undefined, list: { id: string; name: string }[]) =>
    (ids ?? []).map((id) => list.find((x) => x.id === id)?.name ?? "a removed item");
  const ifs = [
    ...names(c.campaignIds, refs.campaigns).map((n) => `campaign is ${n}`),
    ...names(c.accountIds, refs.accounts).map((n) => `mailbox is ${n}`),
    ...(c.interestCodes ?? []).map((n) => `lead status is ${INTEREST[String(n)] ?? n}`),
    ...(c.leadTags ?? []).map((t) => `lead has tag ${t}`),
    ...(c.labels ?? []).map((l) => `label is ${l}`),
  ];
  const parts: [string, string][] = [
    ["When", (TRIGGERS[r.trigger] ?? r.trigger).toLowerCase()],
    ...(ifs.length ? [["if", ifs.join(", ")] as [string, string]] : []),
    ["then", r.actions.map((a) => actionLabel(a.type).toLowerCase()).join(", ")],
  ];
  return (
    <p className="text-[13px]/[18px] text-fg-muted">
      {parts.map(([k, v], i) => (
        <Fragment key={k}>
          {i > 0 && " · "}
          {k} <strong className="font-medium text-fg">{v}</strong>
        </Fragment>
      ))}
    </p>
  );
}

function RulesTab({
  refs,
  canEdit,
  rules,
  reload,
  editor,
}: {
  refs: Refs;
  canEdit: boolean;
  rules: Rule[] | null;
  reload: () => void;
  editor: Editor<Rule>;
}) {
  const { editing, open: openEditor, close: closeEditor } = editor;
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
        onCancel={closeEditor}
        onSaved={() => {
          closeEditor();
          reload();
        }}
      />
    );
  return (
    <div className="flex flex-col gap-3">
      <Err text={error} />
      {rules && !rules.length && (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={Workflow}
            title="No rules yet."
            body="Example: when a reply is classified Interested, move the lead to the Meeting stage."
          />
        </div>
      )}
      {!!rules?.length && (
        <TableFrame>
          <table aria-label="Rules">
            <Head cols={["Rule", "Active", "Actions"]} right={["Actions"]} />
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={cn(!r.enabled && "[&>td]:text-fg-muted")}>
                  <td className="min-w-64 py-2.5">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {r.name}
                      {!r.enabled && (
                        <StatusPill tone="neutral" size="sm">
                          Off
                        </StatusPill>
                      )}
                    </div>
                    <Sentence r={r} refs={refs} />
                  </td>
                  <td className="w-24">
                    <Switch
                      className="md:min-h-0"
                      label={<span className="sr-only">Enable {r.name}</span>}
                      checked={r.enabled}
                      disabled={!canEdit || busy === r.id}
                      onChange={(e) => void act(r, "PATCH", { enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit ${r.name}`}
                        disabled={!canEdit}
                        data-opener={r.id}
                        onClick={() => openEditor(r, r.id)}
                      >
                        <Pencil aria-hidden />
                        <span className="max-md:sr-only">Edit</span>
                      </Button>
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        aria-label={`Delete ${r.name}`}
                        disabled={!canEdit}
                        onClick={() => void act(r, "DELETE")}
                      >
                        <Trash2 aria-hidden />
                        <span className="max-md:sr-only">Delete</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
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
      <p className="text-[13px]/[18px] text-fg-muted">
        These already run inside the app. Only the ones that are not locked can be switched off, by
        an admin.
      </p>
      <Err text={error} />
      <ul
        aria-label="Built-in rules"
        className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface"
      >
        {list?.map((b) => (
          <li key={b.key} className="flex items-start gap-3 px-4 py-3 text-sm">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm bg-sunken">
              {b.locked ? (
                <Lock className="size-3.5 text-fg-muted" aria-hidden />
              ) : (
                <Workflow className="size-3.5 text-fg-muted" aria-hidden />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{humanize(b.key)}</span>
              <span className="text-[13px]/[18px] text-fg-muted">
                {TRIGGERS[b.trigger] ?? b.trigger}
                {b.actions.length ? `: ${b.actions.map(actionLabel).join(", ")}` : ""}
              </span>
              <span className="text-[13px]/[18px] text-fg-subtle">
                {b.reason}{" "}
                {b.settingsHref && (
                  <Link href={b.settingsHref} className="text-signal underline underline-offset-2">
                    Settings
                  </Link>
                )}
              </span>
            </div>
            {b.locked ? (
              <StatusPill tone="neutral" icon={Lock} className="mt-0.5">
                Locked
              </StatusPill>
            ) : (
              <Switch
                className="shrink-0 md:min-h-0"
                label="Enabled"
                checked={b.enabled}
                disabled={!isAdmin}
                onChange={(e) => void toggle(b, e.target.checked)}
              />
            )}
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
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState icon={Workflow} title="No runs yet." body="No rules yet, so nothing has run." />
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="runs-rule">Rule</Label>
        <Select
          id="runs-rule"
          size="sm"
          className="w-full sm:w-64"
          value={id}
          onChange={(e) => setRuleId(e.target.value)}
        >
          {rules?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>
      <Err text={error} />
      {runs && (
        <TableFrame>
          <table aria-label="Runs">
            <Head cols={["Time", "Event", "Result"]} />
            <tbody>
              {runs.map((r) => {
                const label = RUN_LABEL[r.status];
                return (
                  <tr key={r.id} data-stripe={r.status === "FAILED" ? "danger" : undefined}>
                    <td className="whitespace-nowrap tabular-nums">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="font-mono text-[13px] text-fg-muted">{r.eventId}</td>
                    <td>
                      <StatusPill {...pillFor(RUN_STATUS, label)}>{label}</StatusPill>
                      {r.error && (
                        <span className="mt-1 block text-[13px]/[18px] text-fg-muted">
                          {r.error}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!runs.length && (
                <TableEmpty
                  colSpan={3}
                  icon={Workflow}
                  title="No runs yet."
                  body="This rule has not run yet."
                />
              )}
            </tbody>
          </table>
        </TableFrame>
      )}
      {next && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => void load(next)}>
          Next page
        </Button>
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
  // the editors open from the page header, so their state lives here
  const ruleEditor = useInlineEditor<Rule>();
  const hookEditor = useInlineEditor<Hook>();
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
  let action: ReactNode = null;
  if (canEdit && tab === "rules" && !ruleEditor.editing)
    action = (
      <Button data-opener="new" onClick={() => ruleEditor.open("new", "new")}>
        <Plus aria-hidden />
        New rule
      </Button>
    );
  if (canEdit && tab === "webhooks" && !hookEditor.editing)
    action = (
      <Button data-opener="new" onClick={() => hookEditor.open("new", "new")}>
        <Plus aria-hidden />
        New webhook
      </Button>
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automations"
        description="Rules that act on replies, leads and deals. Built-in rules keep sending safe and cannot be turned off."
        actions={action}
      />
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
          <RulesTab
            refs={allRefs}
            canEdit={canEdit}
            rules={rules}
            reload={() => void reload()}
            editor={ruleEditor}
          />
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
            editor={hookEditor}
          />
        )}
      </Tabs>
    </div>
  );
}
