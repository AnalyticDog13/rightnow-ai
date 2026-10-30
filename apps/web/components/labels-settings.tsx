"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { call, errorText } from "../app/(app)/accounts/api-client";
import { SettingsCard } from "./settings-row";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type LabelRow = {
  id: string;
  name: string;
  color: string;
  positive: boolean;
  aiDescription: string | null;
  aiSelectable: boolean;
};

/** Lead labels: name, colour, positive, and whether the reply classifier may pick it (with its description). */
export function LabelsSettings({ labels }: { labels: LabelRow[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  async function done(r: ReturnType<typeof call>, ok: string) {
    const res = await r;
    setMsg(res.ok ? ok : errorText(res));
    if (res.ok) router.refresh();
    return res.ok;
  }
  const patch = (l: LabelRow, body: Partial<LabelRow>) =>
    done(call(`/api/v1/lead-labels/${l.id}`, "PATCH", body), `Saved ${l.name}.`);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const desc = String(f.get("aiDescription")).trim();
    const ok = await done(
      call("/api/v1/lead-labels", "POST", {
        name: String(f.get("name")).trim(),
        color: f.get("color"),
        positive: f.has("positive"),
        aiSelectable: f.has("aiSelectable"),
        aiDescription: desc || null,
      }),
      "Label added.",
    );
    if (ok) form.reset();
  }

  return (
    <SettingsCard
      id="labels"
      title="Lead labels"
      description="Labels you and the reply classifier can put on leads."
    >
      <p role="status" className="text-[13px]/[18px] text-fg-muted empty:hidden">
        {msg}
      </p>
      <ul
        aria-label="Labels"
        className="flex flex-col divide-y divide-border rounded-md border border-border empty:hidden"
      >
        {labels.map((l) => (
          <li
            key={l.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm"
          >
            <span className="inline-flex h-5.5 min-w-24 items-center gap-1.5 rounded-full border border-border px-2 text-xs font-medium">
              <span aria-hidden className="size-2 rounded-full" style={{ background: l.color }} />
              {l.name}
            </span>
            <label className="flex min-h-11 items-center gap-1.5 text-[13px]/[18px] md:min-h-0">
              <input
                type="checkbox"
                checked={l.positive}
                onChange={(e) => void patch(l, { positive: e.target.checked })}
              />
              Positive
            </label>
            <label className="flex min-h-11 items-center gap-1.5 text-[13px]/[18px] md:min-h-0">
              <input
                type="checkbox"
                checked={l.aiSelectable}
                onChange={(e) => void patch(l, { aiSelectable: e.target.checked })}
              />
              AI may choose
            </label>
            <Input
              aria-label={`AI description for ${l.name}`}
              placeholder="When should the AI use it?"
              maxLength={1000}
              className="min-w-48 flex-1 md:h-8 md:text-[13px]/[18px]"
              defaultValue={l.aiDescription ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== l.aiDescription) void patch(l, { aiDescription: v });
              }}
            />
            <Button
              variant="danger-ghost"
              size="sm"
              aria-label={`Delete label ${l.name}`}
              onClick={() => {
                if (confirm(`Delete label ${l.name}? It is removed from every lead.`))
                  void done(call(`/api/v1/lead-labels/${l.id}`, "DELETE"), "Label deleted.");
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={create}
        className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="label-name">New label</Label>
          <Input id="label-name" name="name" required maxLength={50} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="label-color">Colour</Label>
          <input
            id="label-color"
            name="color"
            type="color"
            defaultValue="#3b82f6"
            className="h-11 w-14 rounded-sm border border-input bg-surface p-1 md:h-9"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="label-desc">AI description</Label>
          <Input id="label-desc" name="aiDescription" maxLength={1000} className="w-64" />
        </div>
        <label className="flex min-h-11 items-center gap-1.5 text-[13px]/[18px] md:min-h-9">
          <input type="checkbox" name="positive" />
          Positive
        </label>
        <label className="flex min-h-11 items-center gap-1.5 text-[13px]/[18px] md:min-h-9">
          <input type="checkbox" name="aiSelectable" />
          AI may choose
        </label>
        <Button type="submit" variant="outline">
          Add label
        </Button>
      </form>
    </SettingsCard>
  );
}
