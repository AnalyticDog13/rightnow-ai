"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "../accounts/api-client";

type Saved = { id: string; name: string; filters: Record<string, string> };

/** Saved Leads filters: the inbox-view routes with `scope=leads`. */
export function SavedFilters({
  filters,
  onApply,
}: {
  filters: Record<string, string>;
  onApply: (f: Record<string, string>) => void;
}) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [chosen, setChosen] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const r = await call("/api/v1/inbox/views?scope=leads", "GET");
    if (r.ok) setSaved((r.json.views as Saved[]) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    // empty fields are left out: the server checks what is sent as a leads query
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    const r = await call("/api/v1/inbox/views", "POST", {
      name: name.trim(),
      scope: "leads",
      filters: clean,
    });
    setMsg(r.ok ? `Saved filter ${name.trim()}.` : errorText(r));
    if (r.ok) {
      setName("");
      setChosen((r.json as { id: string }).id);
      void load();
    }
  }
  async function remove() {
    const name = saved.find((s) => s.id === chosen)?.name;
    if (!confirm(`Delete the saved filter ${name}?`)) return;
    const r = await call(`/api/v1/inbox/views/${chosen}`, "DELETE");
    setMsg(r.ok ? "Deleted." : errorText(r));
    setChosen("");
    void load();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Saved filters"
        className="h-10 rounded-md border border-border bg-card px-3 text-sm"
        value={chosen}
        onChange={(e) => {
          setChosen(e.target.value);
          const v = saved.find((s) => s.id === e.target.value);
          if (v) onApply(v.filters);
        }}
      >
        <option value="">Saved filters</option>
        {saved.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {chosen && (
        <Button variant="outline" onClick={() => void remove()}>
          Delete saved filter
        </Button>
      )}
      <Input
        aria-label="Saved filter name"
        placeholder="Name this filter"
        className="max-w-48"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button variant="outline" disabled={!name.trim()} onClick={() => void save()}>
        Save filter
      </Button>
      {msg && (
        <p role="status" className="text-sm">
          {msg}
        </p>
      )}
    </div>
  );
}
