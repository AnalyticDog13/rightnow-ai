"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { call, errorText } from "../../accounts/api-client";
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
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

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
}: {
  campaignId: string;
  variant?: Variant;
  stepId: string;
  variables: string[];
  canEdit: boolean;
  onSaved: () => void;
  onPreview?: () => void;
}) {
  const [subject, setSubject] = useState(variant?.subject ?? "");
  const [body, setBody] = useState(variant?.body ?? "");
  const [weight, setWeight] = useState(String(variant?.weight ?? 1));
  const [errors, setErrors] = useState<string[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
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
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      disabled={!canEdit}
    >
      <legend className="px-1 text-sm font-medium">
        {variant ? `Variant ${variant.label}` : "Add a variant"}
      </legend>
      <Input
        aria-label={`Subject of ${name}`}
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        ref={area}
        aria-label={`Body of ${name}`}
        placeholder="Body (HTML)"
        rows={5}
        className="w-full rounded-md border border-border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Insert variable into ${name}`}
          className={sel}
          value=""
          onChange={(e) => e.target.value && insert(e.target.value)}
        >
          <option value="">Insert variable</option>
          {variables.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          Weight
          <Input
            type="number"
            min={1}
            className="w-20"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        {variant && (
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={variant.active}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Active
          </label>
        )}
        {variant && !variant.active && variant.autoPausedMetric && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs">
            Auto-paused (
            {variant.autoPausedMetric === "open"
              ? "open rate, estimated"
              : `${variant.autoPausedMetric} rate`}
            )
          </span>
        )}
        <Button onClick={() => void save()} disabled={!subject.trim() || !body.trim()}>
          {variant ? "Save variant" : "Add variant"}
        </Button>
        {onPreview && (
          <Button
            variant="outline"
            onClick={onPreview}
            aria-label={`Preview variant ${variant!.label}`}
          >
            Preview
          </Button>
        )}
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
          {errors.map((e, n) => (
            <li key={n}>{e}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** Steps with their variants, for the main sequence (`subsequenceId` null) or one subsequence. */
export function StepsEditor({
  steps,
  subsequenceId,
  reload,
  ...c
}: Common & { steps: Step[]; subsequenceId: string | null; reload: () => void }) {
  const [preview, setPreview] = useState<{ stepId: string; variantId: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [delays, setDelays] = useState<Record<string, { v: string; u: string }>>({});
  const api = `/api/v1/campaigns/${c.campaignId}/steps`;
  const done = () => {
    reload();
    c.onChange();
  };

  async function act(r: ReturnType<typeof call>) {
    const res = await r;
    setMsg(res.ok ? "" : errorText(res));
    if (res.ok) done();
  }

  return (
    <div className="flex flex-col gap-4">
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}
      {steps.map((s) => {
        const d = delays[s.id] ?? { v: String(s.delayValue), u: s.delayUnit };
        return (
          <Card key={s.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Step {s.order}</h3>
              {s.order === 1 ? (
                <p className="text-sm text-muted-foreground">Sent first, no delay</p>
              ) : (
                c.canEdit && (
                  <div className="flex items-center gap-2 text-sm">
                    <label className="flex items-center gap-1">
                      Wait
                      <Input
                        type="number"
                        min={0}
                        className="w-20"
                        aria-label={`Delay of step ${s.order}`}
                        value={d.v}
                        onChange={(e) =>
                          setDelays({ ...delays, [s.id]: { ...d, v: e.target.value } })
                        }
                      />
                    </label>
                    <select
                      aria-label={`Delay unit of step ${s.order}`}
                      className={sel}
                      value={d.u}
                      onChange={(e) =>
                        setDelays({ ...delays, [s.id]: { ...d, u: e.target.value } })
                      }
                    >
                      <option value="MINUTES">minutes</option>
                      <option value="HOURS">hours</option>
                      <option value="DAYS">days</option>
                    </select>
                    <Button
                      variant="outline"
                      aria-label={`Save delay of step ${s.order}`}
                      onClick={() =>
                        void act(
                          call(`${api}/${s.id}`, "PATCH", {
                            delayValue: Number(d.v) || 0,
                            delayUnit: d.u,
                          }),
                        )
                      }
                    >
                      Save delay
                    </Button>
                  </div>
                )
              )}
              {c.canEdit && (
                <Button
                  variant="outline"
                  aria-label={`Delete step ${s.order}`}
                  onClick={() => {
                    if (confirm(`Delete step ${s.order} and its variants?`))
                      void act(call(`${api}/${s.id}`, "DELETE"));
                  }}
                >
                  Delete step
                </Button>
              )}
            </div>
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
            {c.canEdit && (
              <VariantEditor
                campaignId={c.campaignId}
                stepId={s.id}
                variables={c.variables}
                canEdit
                onSaved={done}
              />
            )}
          </Card>
        );
      })}
      {c.canEdit && (
        <Button
          variant="outline"
          className="self-start"
          onClick={() =>
            void act(
              call(api, "POST", {
                delayValue: steps.length ? 2 : 0,
                delayUnit: "DAYS",
                ...(subsequenceId && { subsequenceId }),
              }),
            )
          }
        >
          Add step
        </Button>
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
  if (!steps) return <p className="text-sm text-muted-foreground">Loading...</p>;
  return <StepsEditor {...c} steps={steps} subsequenceId={null} reload={() => void reload()} />;
}
