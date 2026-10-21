"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "../accounts/api-client";
import { INTEREST } from "./labels";

export type Named = { id: string; name: string };
export type Member = { userId: string; name: string };
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

export function BulkBar({
  ids,
  emails,
  lists,
  members,
  fromListId,
  filterQuery,
  isAdmin,
  onDone,
}: {
  ids: string[];
  /** emails of the selected leads, for "add to blocklist" */
  emails: string[];
  lists: Named[];
  members: Member[];
  /** the list filter currently applied, which enables "Move" */
  fromListId: string;
  /** the current lead filters as a query string, used when the selection is too big to export by id */
  filterQuery: string;
  isAdmin: boolean;
  onDone: (message: string, ok: boolean) => void;
}) {
  const [owner, setOwner] = useState("");
  const [interest, setInterest] = useState("");
  const [tags, setTags] = useState("");
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(
    label: string,
    url: string,
    body: unknown,
    detail?: (j: Record<string, unknown>) => string,
  ) {
    setBusy(true);
    const r = await call(url, "POST", body);
    setBusy(false);
    onDone(
      r.ok ? `${label}: ${detail ? detail(r.json) : "done."}` : `${label}: ${errorText(r)}`,
      r.ok,
    );
  }
  const bulk = (label: string, action: string, value?: unknown) =>
    run(label, "/api/v1/leads/bulk", { ids, action, value });
  const tagList = () =>
    tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  const over = ids.length > 1000; // the API refuses more; never export a cut selection
  const target = lists.find((l) => l.id === list);

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
    >
      <span className="text-sm font-medium">{ids.length} selected</span>

      <select
        aria-label="Assign to"
        className={sel}
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
      >
        <option value="">Assign to…</option>
        <option value="__rr">Round-robin across all members</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        disabled={busy || !owner}
        onClick={() =>
          owner === "__rr"
            ? bulk(
                "Assign",
                "assign_round_robin",
                members.map((m) => m.userId),
              )
            : bulk("Assign", "set_owner", owner)
        }
      >
        Assign
      </Button>

      <select
        aria-label="Interest status"
        className={sel}
        value={interest}
        onChange={(e) => setInterest(e.target.value)}
      >
        <option value="">Set interest…</option>
        {Object.entries(INTEREST).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
        <option value="none">Lead (no status)</option>
      </select>
      <Button
        variant="outline"
        disabled={busy || !interest}
        onClick={() =>
          bulk("Interest", "set_interest", interest === "none" ? null : Number(interest))
        }
      >
        Set interest
      </Button>

      <Input
        aria-label="Tags (comma separated)"
        placeholder="tag1, tag2"
        className="max-w-40"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <Button
        variant="outline"
        disabled={busy || !tagList().length}
        onClick={() => bulk("Add tags", "add_tags", tagList())}
      >
        Add tags
      </Button>
      <Button
        variant="outline"
        disabled={busy || !tagList().length}
        onClick={() => bulk("Remove tags", "remove_tags", tagList())}
      >
        Remove tags
      </Button>

      <select
        aria-label="Target list"
        className={sel}
        value={list}
        onChange={(e) => setList(e.target.value)}
      >
        <option value="">Choose a list…</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        disabled={busy || !list}
        onClick={() =>
          run(`Add to ${target?.name}`, `/api/v1/lead-lists/${list}/leads`, { leadIds: ids })
        }
      >
        Add to list
      </Button>
      <Button
        variant="outline"
        disabled={busy || !list || !fromListId || list === fromListId}
        title={fromListId ? undefined : "Filter by a list first to move leads out of it"}
        onClick={() =>
          run(`Move to ${target?.name}`, `/api/v1/lead-lists/${fromListId}/move`, {
            leadIds: ids,
            toListId: list,
          })
        }
      >
        Move to list
      </Button>

      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          if (
            confirm(
              `Add ${emails.length} address(es) to the blocklist? They will never be emailed.`,
            )
          )
            void run(
              "Blocklist",
              "/api/v1/blocklist",
              { values: emails },
              (j) => `added ${j.added}, already listed ${j.duplicates}, invalid ${j.invalid}.`,
            );
        }}
      >
        Add to blocklist
      </Button>
      <Button asChild variant="outline">
        <a
          href={`/api/v1/leads/export?${over ? filterQuery : `ids=${ids.join(",")}`}`}
          download="leads.csv"
        >
          {over ? "Export all matching the filter (selection is over 1,000)" : "Export selected"}
        </a>
      </Button>
      {isAdmin && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete ${ids.length} lead(s)?`)) void bulk("Delete", "delete");
          }}
        >
          Delete
        </Button>
      )}
    </div>
  );
}
