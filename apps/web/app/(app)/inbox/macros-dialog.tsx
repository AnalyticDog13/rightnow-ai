"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "../accounts/api-client";

export type Macro = { id: string; name: string; body: string };

/** PS-INBOX-09: create, edit and delete reply macros (the composer's "Insert macro" list). */
export function MacrosDialog({
  macros,
  onChanged,
  onClose,
}: {
  macros: Macro[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");

  const reset = () => {
    setEditing(null);
    setName("");
    setBody("");
  };
  async function save() {
    setErr("");
    const r = editing
      ? await call(`/api/v1/inbox/macros/${editing}`, "PATCH", { name, body })
      : await call("/api/v1/inbox/macros", "POST", { name, body });
    if (!r.ok) return setErr(errorText(r));
    reset();
    await onChanged();
  }
  async function remove(id: string) {
    setErr("");
    const r = await call(`/api/v1/inbox/macros/${id}`, "DELETE");
    if (!r.ok) return setErr(errorText(r));
    if (editing === id) reset();
    await onChanged();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="macros-title"
      onClose={onClose}
      className="m-auto w-full max-w-lg rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/40"
    >
      <h2 id="macros-title" className="mb-3 text-lg font-semibold">
        Macros
      </h2>
      <ul className="mb-4 flex flex-col divide-y divide-border">
        {macros.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="truncate">{m.name}</span>
            <span className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                aria-label={`Edit ${m.name}`}
                onClick={() => {
                  setEditing(m.id);
                  setName(m.name);
                  setBody(m.body);
                }}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-label={`Delete ${m.name}`}
                onClick={() => void remove(m.id)}
              >
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor="macro-name" className="text-sm">
          Name
        </label>
        <Input
          id="macro-name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="macro-body" className="text-sm">
          Body
        </label>
        <textarea
          id="macro-body"
          value={body}
          rows={5}
          maxLength={10_000}
          aria-describedby="macro-hint"
          onChange={(e) => setBody(e.target.value)}
          className="rounded-md border border-border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
        />
        <p id="macro-hint" className="text-xs text-muted-foreground">
          Variables such as {"{{firstName}}"}, {"{{companyName}}"} or{" "}
          {"{{sendingAccountFirstName}}"} are filled in from the conversation&apos;s lead and
          mailbox.
        </p>
        {err && (
          <p role="alert" className="text-sm text-red-600">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {editing && (
            <Button type="button" variant="outline" onClick={reset}>
              Cancel edit
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => ref.current?.close()}>
            Close
          </Button>
          <Button type="submit" disabled={!name.trim() || !body.trim()}>
            Save macro
          </Button>
        </div>
      </form>
    </dialog>
  );
}
