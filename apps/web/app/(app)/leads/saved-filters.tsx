"use client";

import { BookmarkPlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
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

  // B5.8 asks for chip buttons; the native select stays because tests pick a saved filter with selectOption.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        size="sm"
        aria-label="Saved filters"
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
      </Select>
      {chosen && (
        <Button variant="danger-ghost" size="sm" onClick={() => void remove()}>
          <Trash2 aria-hidden />
          Delete saved filter
        </Button>
      )}
      <span className="flex items-center gap-2 max-sm:w-full md:ml-auto">
        <Input
          aria-label="Saved filter name"
          placeholder="Name this filter"
          className="md:h-8 md:w-44 md:text-[13px]/[18px]"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button variant="ghost" size="sm" disabled={!name.trim()} onClick={() => void save()}>
          <BookmarkPlus aria-hidden />
          Save filter
        </Button>
      </span>
      {msg && (
        <p role="status" className="w-full text-[13px]/[18px] text-fg-muted">
          {msg}
        </p>
      )}
    </div>
  );
}
