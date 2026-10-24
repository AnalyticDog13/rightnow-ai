"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { call, errorText } from "../app/(app)/accounts/api-client";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
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
    <Card>
      <section aria-labelledby="labels-title" className="flex flex-col gap-4">
        <h2 id="labels-title" className="text-lg font-medium">
          Lead labels
        </h2>
        <p role="status" className="text-sm text-muted-foreground">
          {msg}
        </p>
        <ul aria-label="Labels" className="flex flex-col gap-3">
          {labels.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span
                aria-hidden
                className="size-4 rounded-full border border-border"
                style={{ background: l.color }}
              />
              <span className="min-w-24 font-medium">{l.name}</span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={l.positive}
                  onChange={(e) => void patch(l, { positive: e.target.checked })}
                />
                Positive
              </label>
              <label className="flex items-center gap-1">
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
                className="max-w-xs"
                defaultValue={l.aiDescription ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== l.aiDescription) void patch(l, { aiDescription: v });
                }}
              />
              <Button
                variant="outline"
                className="h-8 px-2 text-xs"
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
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="label-name">New label</Label>
            <Input id="label-name" name="name" required maxLength={50} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="label-color">Colour</Label>
            <input
              id="label-color"
              name="color"
              type="color"
              defaultValue="#3b82f6"
              className="h-10 w-14 rounded-md border border-border bg-card"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="label-desc">AI description</Label>
            <Input id="label-desc" name="aiDescription" maxLength={1000} className="w-64" />
          </div>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="positive" />
            Positive
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="aiSelectable" />
            AI may choose
          </label>
          <Button type="submit">Add label</Button>
        </form>
      </section>
    </Card>
  );
}
