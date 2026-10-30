"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Callout } from "../../../components/callout";
import { pillFor, STAGE_KIND, StatusPill } from "../../../components/status-pill";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { Label } from "../../../components/ui/label";
import { call } from "../accounts/api-client";
import { INTEREST } from "../leads/labels";
import { friendly, type BoardData, type Kind } from "./types";

type Stage = { id: string; name: string; kind: Kind; interestCodes: number[] };
const KINDS: Kind[] = ["OPEN", "WON", "LOST"];
const KIND_LABEL = { OPEN: "Open", WON: "Won", LOST: "Lost" } as const;

function Row({
  stage,
  stages,
  count,
  index,
  onChanged,
  onError,
}: {
  stage: Stage;
  stages: Stage[];
  count: number;
  index: number;
  onChanged: (stages?: Stage[]) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(stage.name);
  const [kind, setKind] = useState(stage.kind);
  const [codes, setCodes] = useState(new Set(stage.interestCodes));
  const [moveTo, setMoveTo] = useState("");

  async function patch(body: Record<string, unknown>) {
    const r = await call(`/api/v1/crm/stages/${stage.id}`, "PATCH", body);
    if (!r.ok) return onError(friendly(r));
    onError("");
    onChanged(r.json.stages as Stage[]);
  }
  async function remove() {
    const r = await call(`/api/v1/crm/stages/${stage.id}?moveTo=${moveTo}`, "DELETE");
    if (!r.ok) return onError(friendly(r));
    onError("");
    onChanged();
  }
  const toggle = (c: number) =>
    setCodes((s) => {
      const n = new Set(s);
      if (!n.delete(c)) n.add(c);
      return n;
    });
  const targets = stages.filter((s) => s.id !== stage.id && s.kind === stage.kind);

  return (
    <fieldset
      aria-label={`Stage ${stage.name}`}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <StatusPill
          {...pillFor(STAGE_KIND, KIND_LABEL[stage.kind])}
          className="self-center max-sm:order-first max-sm:w-auto"
        >
          {KIND_LABEL[stage.kind]}
        </StatusPill>
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor={`name-${stage.id}`}>Name</Label>
          <Input
            id={`name-${stage.id}`}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`kind-${stage.id}`}>Kind</Label>
          <Select
            id={`kind-${stage.id}`}
            value={kind}
            disabled={count > 0}
            aria-describedby={count > 0 ? `kind-why-${stage.id}` : undefined}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "OPEN" ? "Open" : k === "WON" ? "Won" : "Lost"}
              </option>
            ))}
          </Select>
          {count > 0 && (
            <span id={`kind-why-${stage.id}`} className="text-[13px]/[18px] text-fg-subtle">
              Fixed while the stage holds {count} {count === 1 ? "deal" : "deals"}.
            </span>
          )}
        </div>
        <span className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Move ${stage.name} up`}
            disabled={index === 0}
            onClick={() => void patch({ position: index - 1 })}
          >
            <ArrowUp aria-hidden />
            <span className="max-md:sr-only">Move up</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Move ${stage.name} down`}
            disabled={index === stages.length - 1}
            onClick={() => void patch({ position: index + 1 })}
          >
            <ArrowDown aria-hidden />
            <span className="max-md:sr-only">Move down</span>
          </Button>
        </span>
      </div>
      <div
        role="group"
        aria-label={`Interest statuses for ${stage.name}`}
        className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]/[18px]"
      >
        {Object.entries(INTEREST).map(([code, label]) => (
          <label key={code} className="flex min-h-11 items-center gap-1.5 md:min-h-6">
            <input
              type="checkbox"
              checked={codes.has(Number(code))}
              onChange={() => toggle(Number(code))}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            void patch({
              name: name.trim(),
              ...(kind !== stage.kind && { kind }),
              interestCodes: [...codes].sort((a, b) => a - b),
            })
          }
        >
          Save
        </Button>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`move-${stage.id}`}>Move deals to</Label>
            <Select
              id={`move-${stage.id}`}
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
            >
              <option value="">Choose a stage</option>
              {targets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            variant="danger-ghost"
            disabled={!moveTo}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden />
            Delete
          </Button>
        </div>
      </div>
    </fieldset>
  );
}

export function StageSettings({
  currency,
  currencyLocked,
}: {
  currency: string;
  currencyLocked: boolean;
}) {
  const router = useRouter();
  const [stages, setStages] = useState<Stage[]>([]);
  const [counts, setCounts] = useState(new Map<string, number>());
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<Kind>("OPEN");
  const [cur, setCur] = useState(currency);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [s, b] = await Promise.all([
      call("/api/v1/crm/stages", "GET"),
      call("/api/v1/crm/opportunities?view=board", "GET"),
    ]);
    if (!s.ok) return setError(friendly(s));
    setStages(s.json.stages as Stage[]);
    setCounts(new Map((b.json as unknown as BoardData).stages?.map((x) => [x.id, x.count])));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const changed = () => {
    void load();
    router.refresh();
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    const r = await call("/api/v1/crm/stages", "POST", { name: newName.trim(), kind: newKind });
    if (!r.ok) return setError(friendly(r));
    setError("");
    setNewName("");
    changed();
  }

  async function workspace(body: Record<string, unknown>) {
    const r = await call("/api/v1/settings/workspace", "PATCH", body);
    setMsg(r.ok ? "Saved." : friendly(r));
    if (r.ok) router.refresh();
    return r.ok;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}
      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Pipeline options</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currency">Currency (one per workspace)</Label>
            <Input
              id="currency"
              className="w-28"
              maxLength={3}
              value={cur}
              disabled={currencyLocked}
              aria-describedby={currencyLocked ? "currency-why" : undefined}
              onChange={(e) => setCur(e.target.value.toUpperCase())}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={currencyLocked || cur === currency}
            onClick={() => void workspace({ currency: cur })}
          >
            Save currency
          </Button>
        </div>
        {currencyLocked && (
          <Callout tone="neutral" className="sm:max-w-xl">
            <span id="currency-why">
              The currency cannot change while a deal has a value or cash collected.
            </span>
          </Callout>
        )}
        <p className="text-[13px]/[18px] text-fg-muted">
          Automatic opportunities from positive replies are managed in{" "}
          <Link
            href="/automations?tab=builtin"
            className="text-signal underline underline-offset-2"
          >
            Automations
          </Link>
          .
        </p>
        {msg && (
          <p role="status" className="text-[13px]/[18px]">
            {msg}
          </p>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Stages</h2>
        <p className="text-[13px]/[18px] text-fg-muted">
          A pipeline keeps at least one open, one won and one lost stage. An interest status can map
          to one stage.
        </p>
        {stages.map((s, i) => (
          <Row
            key={s.id}
            stage={s}
            stages={stages}
            count={counts.get(s.id) ?? 0}
            index={i}
            onError={setError}
            onChanged={(next) => {
              if (next) setStages(next);
              changed();
            }}
          />
        ))}
        <form
          onSubmit={add}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border-strong p-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-stage-name">New stage name</Label>
            <Input
              id="new-stage-name"
              value={newName}
              maxLength={60}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-stage-kind">New stage kind</Label>
            <Select
              id="new-stage-kind"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as Kind)}
            >
              <option value="OPEN">Open</option>
              <option value="WON">Won</option>
              <option value="LOST">Lost</option>
            </Select>
          </div>
          <Button type="submit" disabled={!newName.trim()}>
            Add stage
          </Button>
        </form>
      </Card>
    </div>
  );
}
