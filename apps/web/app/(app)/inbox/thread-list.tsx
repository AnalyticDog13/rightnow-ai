"use client";

import { Clock, Inbox, Paperclip, Search } from "lucide-react";
import { Fragment, useState, type KeyboardEvent } from "react";
import { EmptyState } from "../../../components/empty-state";
import { pillFor, REPLY_CATEGORY, StatusPill } from "../../../components/status-pill";
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
  bulk,
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
  /** the bulk bar replaces the search row while rows are checked */
  bulk: boolean;
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

  const now = new Date();
  const groups: [string, ThreadRow[]][] = [];
  for (const t of threads) {
    const g = group(new Date(t.lastMessageAt), now);
    const last = groups.at(-1);
    if (last?.[0] === g) last[1].push(t);
    else groups.push([g, [t]]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!bulk && (
        <form
          role="search"
          className="flex flex-wrap items-center gap-2 border-b border-border p-3"
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
          <span className="relative min-w-48 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search conversations"
              placeholder="Search conversations"
              list="recent-searches"
              className="pl-8 md:h-8 md:text-[13px]/[18px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </span>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
          <datalist id="recent-searches">
            {history.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
          <label
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium max-md:h-11",
              attachmentsOnly
                ? "border-signal bg-signal-tint text-signal"
                : "border-border-strong text-fg-muted hover:bg-hover",
            )}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={attachmentsOnly}
              onChange={(e) => onAttachments(e.target.checked)}
            />
            <Paperclip className="size-3" aria-hidden />
            Has attachment
          </label>
          {threads.length > 0 && (
            <label className="ml-auto flex min-h-11 items-center gap-2 text-[13px]/[18px] text-fg-muted md:min-h-0">
              <input
                type="checkbox"
                checked={checked.size === threads.length}
                onChange={(e) => onCheckAll(e.target.checked)}
              />
              Select all
            </label>
          )}
        </form>
      )}
      <ul aria-label="Conversations" onKeyDown={onKey} className="min-h-0 flex-1 overflow-y-auto">
        {groups.map(([g, rows]) => (
          <Fragment key={g}>
            <li
              role="presentation"
              className="micro sticky top-0 z-(--z-sticky) flex h-7 items-center border-b border-border bg-surface px-4 text-fg-subtle"
            >
              {g}
            </li>
            {rows.map((t) => {
              const m = t.messages[0];
              const on = selected === t.id;
              const category = t.category ? CATEGORIES[t.category] : undefined;
              const due = t.reminderAt && new Date(t.reminderAt) <= now;
              return (
                <li
                  key={t.id}
                  className={cn(
                    "group/row relative flex items-start gap-2 border-b border-border py-2.5 pr-3 pl-3 transition-colors duration-(--dur-1) hover:bg-hover",
                    on && "bg-signal-tint stripe-signal hover:bg-signal-tint",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.subject}`}
                    className="mt-1 shrink-0 md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100 md:checked:opacity-100"
                    checked={checked.has(t.id)}
                    onChange={(e) => onCheck(t.id, e.target.checked)}
                  />
                  <button
                    type="button"
                    data-row
                    aria-current={on ? "true" : undefined}
                    onClick={() => onSelect(t.id)}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-xs text-left focus-visible:-outline-offset-2"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      {!t.isRead && (
                        <span aria-hidden className="size-2 shrink-0 rounded-full bg-signal" />
                      )}
                      <span className={cn("truncate", t.isRead ? "font-medium" : "font-semibold")}>
                        {m ? who(m) : ""}
                      </span>
                      {!t.isRead && <span className="sr-only">Unread</span>}
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-subtle tabular-nums">
                        {when(new Date(t.lastMessageAt), now)}
                      </span>
                    </span>
                    <span className={cn("truncate text-sm", !t.isRead && "font-medium")}>
                      {t.subject}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px]/[18px] text-fg-muted">
                        {m?.snippet?.slice(0, 120)}
                      </span>
                      {t.hasAttachment && (
                        <Paperclip
                          className="size-3 shrink-0 text-fg-muted"
                          aria-label="Has attachment"
                        />
                      )}
                      {due && (
                        <StatusPill tone="warning" size="sm" icon={Clock}>
                          Reminder due
                        </StatusPill>
                      )}
                      {category && (
                        <StatusPill {...pillFor(REPLY_CATEGORY, category)} size="sm">
                          {category}
                        </StatusPill>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
      {loaded && threads.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="No conversations in this view."
          body="Replies to your campaigns land here."
        />
      )}
      {hasMore && (
        <div className="border-t border-border p-3">
          <Button variant="outline" className="w-full" onClick={onMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

const DAY = 86_400_000;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** B4.20 date groups. */
function group(d: Date, now: Date) {
  const days = Math.round((midnight(now) - midnight(d)) / DAY);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Older";
}
/** "14:02" today, "Oct 3" before. */
function when(d: Date, now: Date) {
  return midnight(d) === midnight(now)
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
