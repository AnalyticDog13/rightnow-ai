"use client";

import { useEffect, useState, type FormEvent } from "react";
import { dialogClass } from "../../../components/overlay";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { Label } from "../../../components/ui/label";
import { call } from "../accounts/api-client";
import type { Named } from "../leads/bulk-bar";
import { checkMoney, useDialog } from "./drawer-kit";
import { friendly, type StageOption } from "./types";

type Found = { id: string; email: string };

/** Create a deal for a lead found with `GET /api/v1/leads?q=`. */
export function NewOpportunity({
  stages,
  campaigns,
  onClose,
  onCreated,
}: {
  stages: StageOption[];
  campaigns: Named[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const dlg = useDialog(onClose, dialogClass(640));
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [stageId, setStageId] = useState(stages.find((s) => s.kind === "OPEN")?.id ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!q.trim()) return setFound([]);
    let live = true;
    const t = setTimeout(async () => {
      const r = await call(`/api/v1/leads?${new URLSearchParams({ q: q.trim() })}`, "GET");
      if (live) setFound(((r.json.leads ?? []) as Found[]).slice(0, 50));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!leadId) return setError("Choose a lead first.");
    const bad = value.trim() ? checkMoney("Value", value) : "";
    if (bad) return setError(bad);
    const r = await call("/api/v1/crm/opportunities", "POST", {
      leadId,
      stageId,
      ...(title.trim() && { title: title.trim() }),
      ...(value.trim() && { value: Number(value) }),
      ...(campaignId && { campaignId }),
    });
    if (!r.ok) return setError(friendly(r));
    onCreated();
    dlg.close();
  }

  return (
    <dialog {...dlg.props} aria-labelledby="new-opp-title">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="new-opp-title" className="text-lg/[26px] font-semibold">
          New opportunity
        </h2>
        <Button variant="ghost" onClick={dlg.close}>
          Close
        </Button>
      </div>
      <form onSubmit={create} noValidate className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-find">Find a lead</Label>
          <Input
            id="new-find"
            type="search"
            placeholder="Email, name or company"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-lead">Lead</Label>
          <Select id="new-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">{found.length ? "Choose a lead" : "Search first"}</option>
            {found.map((l) => (
              <option key={l.id} value={l.id}>
                {l.email}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-title">Title</Label>
          <Input
            id="new-title"
            placeholder="Defaults to the company or email"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-value">Value</Label>
          <Input
            id="new-value"
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-stage">Stage</Label>
          <Select id="new-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-campaign">Campaign (optional)</Label>
          <Select
            id="new-campaign"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">None</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {error && (
          <p role="alert" className="text-[13px]/[18px] text-danger sm:col-span-2">
            {error}
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={dlg.close}>
            Cancel
          </Button>
          <Button type="submit">Create opportunity</Button>
        </div>
      </form>
    </dialog>
  );
}
