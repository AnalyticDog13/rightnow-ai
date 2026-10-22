"use client";

import { Paperclip } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { CATEGORIES, who, type ThreadRow } from "./types";

const KEY = "inbox:recent-searches";
const recent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const remember = (q: string) => {
  try {
    localStorage.setItem(KEY, JSON.stringify([q, ...recent().filter((x) => x !== q)].slice(0, 8)));
  } catch {
    /* storage unavailable: searching still works */
  }
};

export function ThreadList({
  threads,
  selected,
  checked,
  hasMore,
  loaded,
  q,
  attachmentsOnly,
  onSelect,
  onCheck,
  onCheckAll,
  onMore,
  onSearch,
  onAttachments,
}: {
  threads: ThreadRow[];
  selected: string | null;
  checked: Set<string>;
  hasMore: boolean;
  loaded: boolean;
  q: string;
  attachmentsOnly: boolean;
  onSelect: (id: string) => void;
  onCheck: (id: string, on: boolean) => void;
  onCheckAll: (on: boolean) => void;
  onMore: () => void;
  onSearch: (q: string) => void;
  onAttachments: (on: boolean) => void;
}) {
  const [text, setText] = useState(q);
  const [history, setHistory] = useState<string[]>(recent);

  // arrow keys move between rows; Tab still reaches every control
  function onKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-row]")];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const to = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (i < 0 || !to) return;
    e.preventDefault();
    to.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        role="search"
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = text.trim();
          if (v) {
            remember(v);
            setHistory(recent());
          }
          onSearch(v);
        }}
      >
        <div className="flex gap-2">
          <Input
            aria-label="Search conversations"
            placeholder="Search conversations"
            list="recent-searches"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </div>
        <datalist id="recent-searches">
          {history.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={attachmentsOnly}
            onChange={(e) => onAttachments(e.target.checked)}
          />
          Has attachment
        </label>
      </form>
      {threads.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={checked.size === threads.length}
            onChange={(e) => onCheckAll(e.target.checked)}
          />
          Select all
        </label>
      )}
      <ul
        aria-label="Conversations"
        onKeyDown={onKey}
        className="flex flex-col divide-y divide-border rounded-md border border-border"
      >
        {threads.map((t) => {
          const m = t.messages[0];
          return (
            <li
              key={t.id}
              className={cn("flex items-start gap-2 p-2", selected === t.id && "bg-muted")}
            >
              <input
                type="checkbox"
                aria-label={`Select ${t.subject}`}
                className="mt-1"
                checked={checked.has(t.id)}
                onChange={(e) => onCheck(t.id, e.target.checked)}
              />
              <button
                type="button"
                data-row
                aria-current={selected === t.id ? "true" : undefined}
                onClick={() => onSelect(t.id)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 text-left focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span
                  className={cn(
                    "flex items-center justify-between gap-2 text-sm",
                    !t.isRead && "font-semibold",
                  )}
                >
                  <span className="truncate">{m ? who(m) : ""}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    {new Date(t.lastMessageAt).toLocaleDateString()}
                  </span>
                </span>
                <span className={cn("truncate text-sm", !t.isRead && "font-semibold")}>
                  {t.subject}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {m?.text?.slice(0, 120)}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {!t.isRead && (
                    <span className="rounded bg-primary px-1 text-primary-foreground">Unread</span>
                  )}
                  {t.category && (
                    <span className="text-muted-foreground">{CATEGORIES[t.category]}</span>
                  )}
                  {t.hasAttachment && <Paperclip className="size-3" aria-label="Has attachment" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {loaded && threads.length === 0 && (
        <p className="p-2 text-sm text-muted-foreground">No conversations here.</p>
      )}
      {hasMore && (
        <Button variant="outline" onClick={onMore}>
          Load more
        </Button>
      )}
    </div>
  );
}
