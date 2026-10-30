"use client";

import { useState } from "react";
import { useAiOn } from "../../../components/ai-assist";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { BulkToolbar } from "../../../components/table-kit";
import { call, errorText } from "../accounts/api-client";
import { INTEREST } from "./labels";

export type Named = { id: string; name: string };
export type Member = { userId: string; name: string };

export function BulkBar({
  ids,
  emails,
  lists,
  members,
  fromListId,
  filterQuery,
  isAdmin,
  onClear,
  onDone,
  onPersonalize,
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
  onClear: () => void;
  onDone: (message: string, ok: boolean) => void;
  /** a queued `ai_personalize` job, so the page can show its suggestions for review */
  onPersonalize?: (jobId: string) => void;
}) {
  const [owner, setOwner] = useState("");
  const [interest, setInterest] = useState("");
  const [tags, setTags] = useState("");
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const aiOn = useAiOn();

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
  async function personalize() {
    const r = await call("/api/v1/ai/personalize", "POST", { leadIds: ids });
    if (!r.ok)
      return onDone(
        `Personalization: ${r.status === 412 ? "AI is not set up (Settings)" : errorText(r)}`,
        false,
      );
    onDone("Personalization queued. Review the suggestions below when they appear.", true);
    onPersonalize?.(String(r.json.jobId));
  }
  const over = ids.length > 1000; // the API refuses more; never export a cut selection
  const target = lists.find((l) => l.id === list);

  return (
    <BulkToolbar count={ids.length} onClear={onClear}>
      <Select
        size="sm"
        aria-label="Assign to"
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
      </Select>
      <Button
        variant="ghost"
        size="sm"
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

      <Select
        size="sm"
        aria-label="Interest status"
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
      </Select>
      <Button
        variant="ghost"
        size="sm"
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
        className="max-w-40 md:h-8 md:text-[13px]/[18px]"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !tagList().length}
        onClick={() => bulk("Add tags", "add_tags", tagList())}
      >
        Add tags
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !tagList().length}
        onClick={() => bulk("Remove tags", "remove_tags", tagList())}
      >
        Remove tags
      </Button>

      <Select
        size="sm"
        aria-label="Target list"
        value={list}
        onChange={(e) => setList(e.target.value)}
      >
        <option value="">Choose a list…</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !list}
        onClick={() =>
          run(`Add to ${target?.name}`, `/api/v1/lead-lists/${list}/leads`, { leadIds: ids })
        }
      >
        Add to list
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !list || !fromListId || list === fromListId}
        title={fromListId ? undefined : "Filter by a list first to move leads out of it"}
        onClick={() =>
          run(
            `Move to ${target?.name}`,
            `/api/v1/lead-lists/${fromListId}/move`,
            { leadIds: ids, toListId: list },
            (j) => `moved ${j.moved}, skipped ${j.skipped} (not in the source list).`,
          )
        }
      >
        Move to list
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() =>
          run("Verify", "/api/v1/leads/verify", { ids }, (j) => `queued ${j.queued} for checking.`)
        }
      >
        Verify
      </Button>
      <Button
        variant="ghost"
        size="sm"
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
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="text-bg hover:bg-white/12 dark:hover:bg-black/12"
      >
        <a
          href={`/api/v1/leads/export?${over ? filterQuery : `ids=${ids.join(",")}`}`}
          download="leads.csv"
        >
          {over ? "Export all matching the filter (selection is over 1,000)" : "Export selected"}
        </a>
      </Button>
      {aiOn && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || ids.length > 500}
          onClick={() => void personalize()}
        >
          Write personalization (AI)
        </Button>
      )}
      {isAdmin && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete ${ids.length} lead(s)?`)) void bulk("Delete", "delete");
          }}
        >
          Delete
        </Button>
      )}
    </BulkToolbar>
  );
}
