"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "./api-client";
import { isNumeric } from "./numeric";

// value kinds: "number" (minutes for gaps), "text", "tags" (comma separated)
const SETTINGS = {
  set_daily_limit: { label: "Set daily limit", kind: "number" },
  set_gap: { label: "Set minimum gap (minutes)", kind: "minutes" },
  set_signature: { label: "Set signature", kind: "text" },
  add_tags: { label: "Add tags", kind: "tags" },
  remove_tags: { label: "Remove tags", kind: "tags" },
} as const;
type Setting = keyof typeof SETTINGS;

export function BulkBar({
  ids,
  names,
  isAdmin,
  onDone,
}: {
  ids: string[];
  /** id to email, for the clamp notice. */
  names: Record<string, string>;
  isAdmin: boolean;
  onDone: (message: string) => void;
}) {
  const [setting, setSetting] = useState<Setting>("set_daily_limit");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function run(action: string, v?: unknown) {
    if (action === "delete" && !confirm(`Delete ${ids.length} account(s)? Sent history is kept.`))
      return;
    setBusy(true);
    const r = await call("/api/v1/accounts/bulk", "POST", { ids, action, value: v });
    setBusy(false);
    const results = (r.json.results ?? []) as {
      id: string;
      ok: boolean;
      error?: string;
      warnings?: { field: string; clampedTo: number }[];
    }[];
    const failed = results.filter((x) => !x.ok);
    const clamped = results.flatMap((x) =>
      (x.warnings ?? []).map((w) => `${names[x.id] ?? x.id} was set to ${w.clampedTo}`),
    );
    onDone(
      !r.ok
        ? errorText(r)
        : [
            failed.length &&
              `${failed.length} of ${results.length} failed (${[...new Set(failed.map((f) => f.error))].join(", ")}).`,
            clamped.length && `Limited by the provider: ${clamped.join("; ")}.`,
          ]
            .filter(Boolean)
            .join(" "),
    );
  }

  function apply() {
    const kind = SETTINGS[setting].kind;
    if ((kind === "number" || kind === "minutes") && !isNumeric(value)) {
      setProblem("Enter a number first.");
      return;
    }
    const v =
      kind === "number"
        ? Number(value)
        : kind === "minutes"
          ? Math.round(Number(value) * 60)
          : kind === "tags"
            ? value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : value;
    setProblem("");
    void run(setting, v);
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
    >
      <span className="text-sm font-medium">{ids.length} selected</span>
      <Button variant="outline" disabled={busy} onClick={() => run("pause")}>
        Pause
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => run("resume")}>
        Resume
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => run("warmup_enable")}>
        Enable warm-up
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => run("warmup_disable")}>
        Disable warm-up
      </Button>
      <select
        aria-label="Bulk setting"
        className="h-10 rounded-md border border-border bg-card px-3 text-sm"
        value={setting}
        onChange={(e) => setSetting(e.target.value as Setting)}
      >
        {(Object.keys(SETTINGS) as Setting[]).map((k) => (
          <option key={k} value={k}>
            {SETTINGS[k].label}
          </option>
        ))}
      </select>
      <Input
        aria-label="Bulk value"
        className="max-w-48"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button disabled={busy} onClick={apply}>
        Apply
      </Button>
      {problem && (
        <p role="alert" className="w-full text-sm text-destructive">
          {problem}
        </p>
      )}
      {isAdmin && (
        <Button variant="outline" disabled={busy} onClick={() => run("delete")}>
          Delete
        </Button>
      )}
    </div>
  );
}
