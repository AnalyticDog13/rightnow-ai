"use client";

import {
  AlertTriangle,
  ChevronRight,
  Eye,
  ListOrdered,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Callout } from "../../../../components/callout";
import { EmptyState } from "../../../../components/empty-state";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input, Textarea } from "../../../../components/ui/input";
import { Select } from "../../../../components/ui/select";
import { Switch } from "../../../../components/ui/switch";
import { cn } from "../../../../lib/utils";
import { call, errorText } from "../../accounts/api-client";
import { toHtml } from "../../inbox/composer";
import { AiAssist } from "../../../../components/ai-assist";
import { PreviewPanel } from "./preview-panel";

export type Variant = {
  id: string;
  label: string;
  subject: string;
  body: string;
  weight: number;
  active: boolean;
  autoPausedMetric?: string | null;
};
export type Step = {
  id: string;
  order: number;
  delayValue: number;
  delayUnit: "MINUTES" | "HOURS" | "DAYS";
  variants: Variant[];
};
type Common = {
  campaignId: string;
  variables: string[];
  canEdit: boolean;
  isAdmin: boolean;
  onChange: () => void;
};
type Issue = { field?: string; message: string };

/** Errors from the API (template_invalid carries validateTemplate's issues) as readable lines. */
function problems(r: { json: Record<string, unknown> }): string[] {
  const issues = r.json.issues as Issue[] | undefined;
  return issues?.length
    ? issues.map((i) => `${i.field ? `${i.field}: ` : ""}${i.message}`)
    : [errorText(r)];
}

function VariantEditor({
  campaignId,
  variant,
  stepId,
  variables,
  canEdit,
  onSaved,
  onPreview,
  onCancel,
}: {
  campaignId: string;
  variant?: Variant;
  stepId: string;
  variables: string[];
  canEdit: boolean;
  onSaved: () => void;
  onPreview?: () => void;
  onCancel?: () => void;
}) {
  const [subject, setSubject] = useState(variant?.subject ?? "");
  const [body, setBody] = useState(variant?.body ?? "");
  const [weight, setWeight] = useState(String(variant?.weight ?? 1));
  const [errors, setErrors] = useState<string[]>([]);
  const [tone, setTone] = useState("friendly");
  const [offer, setOffer] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const subjectInput = useRef<HTMLInputElement>(null);
  // the add form is revealed by "+ Add variant": focus moves to its Subject field
  useEffect(() => {
    if (!variant) subjectInput.current?.focus();
  }, [variant]);
  const name = variant ? `variant ${variant.label}` : "new variant";
  const url = `/api/v1/campaigns/${campaignId}/steps/${stepId}/variants`;

  async function save() {
    const data = { subject, body, weight: Number(weight) || 1 };
    const r = variant
      ? await call(`${url}/${variant.id}`, "PATCH", data)
      : await call(url, "POST", data);
    setErrors(r.ok ? [] : problems(r));
    if (!r.ok) return;
    if (!variant) {
      setSubject("");
      setBody("");
    }
    onSaved();
  }
  async function toggle(active: boolean) {
    const r = await call(`${url}/${variant!.id}`, "PATCH", { active });
    setErrors(r.ok ? [] : problems(r));
    onSaved();
  }
  function insert(v: string) {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? at;
    setBody(`${body.slice(0, at)}{{${v}}}${body.slice(end)}`);
    el?.focus();
  }

  return (
    <fieldset
      id={variant ? `variant-${variant.id}` : undefined}
      className={cn(
        "flex min-w-0 scroll-mt-24 flex-col gap-3 rounded-md border border-border p-4",
        !variant && "border-dashed",
        variant && !variant.active && "bg-sunken",
      )}
      disabled={!canEdit}
    >
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
        {variant ? `Variant ${variant.label}` : "Add a variant"}
        {variant && !variant.active && (
          <span className="font-normal text-fg-subtle" aria-hidden>
            (off)
          </span>
        )}
      </legend>
      {variant && !variant.active && variant.autoPausedMetric && (
        <Callout tone="warning">
          Auto-paused (
          {variant.autoPausedMetric === "open"
            ? "open rate, estimated"
            : `${variant.autoPausedMetric} rate`}
          )
        </Callout>
      )}
      <Input
        ref={subjectInput}
        aria-label={`Subject of ${name}`}
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <Textarea
        ref={area}
        aria-label={`Body of ${name}`}
        placeholder="Body (HTML)"
        rows={6}
        className="min-h-40 font-mono text-[13px]/5"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <details className="group rounded-sm border border-border text-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 md:min-h-9 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-3.5 text-fg-muted transition-transform duration-(--dur-2) group-open:rotate-90"
            aria-hidden
          />
          <Sparkles className="size-3 text-ai" aria-hidden />
          Draft with AI
        </summary>
        <div className="flex flex-col gap-2 border-t border-border p-3 md:flex-row md:flex-wrap md:items-start">
          <Input
            aria-label="Tone"
            className="md:w-40"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          />
          <Input
            aria-label="Offer"
            placeholder="Offer (optional)"
            className="md:w-64"
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
          />
          <AiAssist
            label="Generate draft"
            path="draft"
            body={{
              stepId,
              tone: tone.trim() || "friendly",
              ...(offer.trim() && { offer: offer.trim() }),
            }}
            onUse={(t) => setBody(toHtml(t))}
          />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          size="sm"
          aria-label={`Insert variable into ${name}`}
          className="w-auto"
          value=""
          onChange={(e) => e.target.value && insert(e.target.value)}
        >
          <option value="">Insert variable</option>
          {variables.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-[13px]/[18px] text-fg-muted">
          Weight
          <Input
            type="number"
            min={1}
            className="w-20 md:h-8"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        {variant && (
          <Switch
            label="Active"
            className="text-[13px]/[18px]"
            checked={variant.active}
            onChange={(e) => void toggle(e.target.checked)}
          />
        )}
        <span className="flex gap-2 max-md:w-full md:ml-auto">
          {onPreview && (
            <Button
              variant="outline"
              size="sm"
              className="max-md:flex-1"
              onClick={onPreview}
              aria-label={`Preview variant ${variant!.label}`}
            >
              <Eye aria-hidden />
              Preview
            </Button>
          )}
          {onCancel && (
            <Button variant="ghost" size="sm" className="max-md:flex-1" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            variant={variant ? "default" : "outline"}
            className="max-md:flex-1"
            onClick={() => void save()}
            disabled={!subject.trim() || !body.trim()}
          >
            {variant ? "Save variant" : "Add variant"}
          </Button>
        </span>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-[13px]/[18px] text-danger">
          {errors.map((e, n) => (
            <li key={n}>{e}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

const UNIT: Record<string, [string, string]> = {
  MINUTES: ["minute", "minutes"],
  HOURS: ["hour", "hours"],
  DAYS: ["day", "days"],
};
const waitText = (s: Step) =>
  `Wait ${s.delayValue} ${UNIT[s.delayUnit]![s.delayValue === 1 ? 0 : 1]}`;

/** What is unfinished in a step (B4.19 honest unset state), or null when it can send. */
function problem(s: Step) {
  const on = s.variants.filter((v) => v.active);
  if (s.variants.length === 0 || on.length === 0) return "No active variant";
  if (on.some((v) => !v.subject.trim())) return "Subject not set";
  if (on.some((v) => !v.body.trim())) return "Body not set";
  return null;
}

/** Steps with their variants, for the main sequence (`subsequenceId` null) or one subsequence. */
export function StepsEditor({
  steps,
  subsequenceId,
  reload,
  ...c
}: Common & {
  steps: Step[];
  subsequenceId: string | null;
  reload: () => void;
}) {
  const [preview, setPreview] = useState<{
    stepId: string;
    variantId: string;
  } | null>(null);
  const [msg, setMsg] = useState("");
  const [delays, setDelays] = useState<Record<string, { v: string; u: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // step whose add-variant form is open
  // closing the add form gives focus back to that step's "+ Add variant" chip
  const added = useRef<string | null>(null);
  useEffect(() => {
    if (!adding && added.current) document.getElementById(`add-variant-${added.current}`)?.focus();
    added.current = adding;
  }, [adding]);
  const api = `/api/v1/campaigns/${c.campaignId}/steps`;
  const done = () => {
    reload();
    c.onChange();
  };

  async function act(r: ReturnType<typeof call>) {
    const res = await r;
    setMsg(res.ok ? "" : errorText(res));
    if (res.ok) done();
    return res.ok;
  }
  const addStep = () =>
    void act(
      call(api, "POST", {
        delayValue: steps.length ? 2 : 0,
        delayUnit: "DAYS",
        ...(subsequenceId && { subsequenceId }),
      }),
    );

  return (
    <div className="flex w-full max-w-190 flex-col xl:mx-auto">
      {msg && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {msg}
        </p>
      )}
      {steps.length === 0 && (
        <Card className="p-0 md:p-0">
          <EmptyState
            icon={ListOrdered}
            title="No steps yet."
            body="Add a first step with at least one active variant."
            actions={
              c.canEdit && (
                <Button onClick={addStep}>
                  <Plus aria-hidden />
                  Add step
                </Button>
              )
            }
          />
        </Card>
      )}
      {steps.map((s) => {
        const d = delays[s.id] ?? { v: String(s.delayValue), u: s.delayUnit };
        const bad = problem(s);
        const on = s.variants.filter((v) => v.active).length;
        return (
          <Fragment key={s.id}>
            {s.order > 1 && (
              <div className="relative flex flex-col items-center">
                <span aria-hidden className="h-4 w-0.5 bg-border-strong" />
                {c.canEdit ? (
                  <button
                    type="button"
                    aria-expanded={editing === s.id}
                    aria-label={`${waitText(s)} before step ${s.order}, edit the delay`}
                    onClick={() => setEditing(editing === s.id ? null : s.id)}
                    className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 text-[13px]/[18px] font-medium transition-colors duration-(--dur-1) hover:bg-hover md:h-7"
                  >
                    {waitText(s)}
                    <Pencil className="size-3 text-fg-muted" aria-hidden />
                  </button>
                ) : (
                  <span className="inline-flex h-7 items-center rounded-full border border-border-strong bg-surface px-3 text-[13px]/[18px] font-medium">
                    {waitText(s)}
                  </span>
                )}
                <span aria-hidden className="h-4 w-0.5 bg-border-strong" />
                {editing === s.id && (
                  <div
                    role="group"
                    aria-label={`Edit the delay of step ${s.order}`}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    className="absolute top-full z-(--z-popover) -mt-3 flex flex-wrap items-center gap-2 rounded-md bg-elevated p-3 text-sm shadow-e2"
                  >
                    <label className="flex items-center gap-2">
                      Wait
                      <Input
                        type="number"
                        min={0}
                        className="w-20 md:h-8"
                        aria-label={`Delay of step ${s.order}`}
                        value={d.v}
                        onChange={(e) =>
                          setDelays({
                            ...delays,
                            [s.id]: { ...d, v: e.target.value },
                          })
                        }
                      />
                    </label>
                    <Select
                      size="sm"
                      aria-label={`Delay unit of step ${s.order}`}
                      className="w-auto"
                      value={d.u}
                      onChange={(e) =>
                        setDelays({
                          ...delays,
                          [s.id]: { ...d, u: e.target.value },
                        })
                      }
                    >
                      <option value="MINUTES">minutes</option>
                      <option value="HOURS">hours</option>
                      <option value="DAYS">days</option>
                    </Select>
                    <Button
                      size="sm"
                      aria-label={`Save delay of step ${s.order}`}
                      onClick={() =>
                        void act(
                          call(`${api}/${s.id}`, "PATCH", {
                            delayValue: Number(d.v) || 0,
                            delayUnit: d.u,
                          }),
                        ).then((ok) => ok && setEditing(null))
                      }
                    >
                      Save delay
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
            <Card
              className={cn(
                "flex flex-col gap-4 md:px-5 md:py-4",
                bad && s.variants.length > 0 && "border-warning-solid",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold">Step {s.order}</h3>
                <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]/[18px] text-fg-muted">
                  {s.order === 1 ? "Sends when the lead starts" : waitText(s)} · Email ·{" "}
                  {s.variants.length} variant
                  {s.variants.length === 1 ? "" : "s"} · {on} active
                  {bad && (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertTriangle className="size-3.5" aria-hidden />
                      {bad}
                    </span>
                  )}
                </p>
                {c.canEdit && (
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    aria-label={`Delete step ${s.order}`}
                    onClick={() => {
                      if (confirm(`Delete step ${s.order} and its variants?`))
                        void act(call(`${api}/${s.id}`, "DELETE"));
                    }}
                  >
                    <Trash2 aria-hidden />
                    Delete step
                  </Button>
                )}
              </div>
              {(s.variants.length > 0 || (c.canEdit && adding !== s.id)) && (
                <nav
                  aria-label={`Variants of step ${s.order}`}
                  className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]"
                >
                  {s.variants.map((v) => (
                    <a
                      key={v.id}
                      href={`#variant-${v.id}`}
                      className={cn(
                        "inline-flex h-7 shrink-0 items-center rounded-sm border px-2.5 font-mono text-xs font-medium",
                        v.active
                          ? "border-fg bg-fg text-bg"
                          : "border-border-strong text-fg-subtle",
                      )}
                    >
                      {v.label}
                      {!v.active && " (off)"}
                    </a>
                  ))}
                  {c.canEdit && adding !== s.id && (
                    <Button
                      id={`add-variant-${s.id}`}
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0"
                      onClick={() => setAdding(s.id)}
                    >
                      <Plus aria-hidden />
                      Add variant
                    </Button>
                  )}
                </nav>
              )}
              {s.variants.map((v) => (
                <VariantEditor
                  key={`${v.id}:${v.subject}:${v.body}:${v.weight}`}
                  campaignId={c.campaignId}
                  variant={v}
                  stepId={s.id}
                  variables={c.variables}
                  canEdit={c.canEdit}
                  onSaved={done}
                  onPreview={() => setPreview({ stepId: s.id, variantId: v.id })}
                />
              ))}
              {c.canEdit && adding === s.id && (
                <VariantEditor
                  campaignId={c.campaignId}
                  stepId={s.id}
                  variables={c.variables}
                  canEdit
                  onSaved={() => {
                    setAdding(null);
                    done();
                  }}
                  onCancel={() => setAdding(null)}
                />
              )}
            </Card>
          </Fragment>
        );
      })}
      {c.canEdit && steps.length > 0 && (
        <div className="flex flex-col items-center">
          <span aria-hidden className="h-8 w-0.5 bg-border-strong" />
          <Button variant="outline" onClick={addStep}>
            <Plus aria-hidden />
            Add step
          </Button>
        </div>
      )}
      {preview && (
        <PreviewPanel
          campaignId={c.campaignId}
          {...preview}
          isAdmin={c.isAdmin}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

export function SequencesTab(c: Common) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const reload = useCallback(async () => {
    const r = await call(`/api/v1/campaigns/${c.campaignId}/steps`, "GET");
    if (r.ok) setSteps(r.json.steps as Step[]);
  }, [c.campaignId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (!steps)
    return (
      <p role="status" className="text-sm text-fg-muted">
        Loading...
      </p>
    );
  return <StepsEditor {...c} steps={steps} subsequenceId={null} reload={() => void reload()} />;
}
