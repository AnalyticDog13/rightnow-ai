"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText } from "../accounts/api-client";
import { BulkBar } from "./bulk-bar";
import { Sidebar } from "./sidebar";
import { ThreadList } from "./thread-list";
import { ThreadView } from "./thread-view";
import type { Filter, ThreadRow } from "./types";

const NO_COUNTS = { primary: 0, others: 0, total: 0, remindersDue: 0 };

export function InboxApp({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const [filter, setFilter] = useState<Filter>({ view: "primary" });
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState(NO_COUNTS);
  const [msg, setMsg] = useState("");

  const current = useRef(filter); // a slower response for an earlier filter is dropped
  current.current = filter;
  const load = useCallback(
    async (cursor?: string) => {
      const f = filter;
      const q = new URLSearchParams({ view: f.view, limit: "50" });
      for (const [k, v] of Object.entries(f))
        if (k !== "view" && v !== undefined) q.set(k, String(v));
      if (cursor) q.set("cursor", cursor);
      const r = await call(`/api/v1/inbox/threads?${q}`, "GET");
      if (current.current !== f) return;
      if (!r.ok) return setMsg(errorText(r));
      const got = (r.json.threads ?? []) as ThreadRow[];
      setThreads((o) => (cursor ? [...o, ...got] : got));
      setNext((r.json.nextCursor as string | null) ?? null);
      setLoaded(true);
    },
    [filter],
  );
  const refreshCounts = useCallback(async () => {
    const r = await call("/api/v1/inbox/unread-count", "GET");
    if (r.ok) setCounts(r.json as unknown as typeof NO_COUNTS);
    window.dispatchEvent(new Event("inbox:unread-changed"));
  }, []);

  useEffect(() => {
    setLoaded(false);
    setChecked(new Set());
    void load();
  }, [load]);
  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  const changed = () => {
    void load();
    void refreshCounts();
  };

  async function bulk(action: string, interestStatus?: number | null) {
    const r = await call("/api/v1/inbox/threads/bulk", "POST", {
      ids: [...checked],
      action,
      ...(interestStatus !== undefined && { interestStatus }),
    });
    setMsg(r.ok ? `Updated ${(r.json.affected as number) ?? 0} conversation(s).` : errorText(r));
    if (r.ok && action === "delete" && selected && checked.has(selected)) setSelected(null);
    setChecked(new Set());
    changed();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Unified inbox</h1>
        {filter.view === "scheduled" && (
          <Link href="/scheduled" className="text-sm underline">
            Open Scheduled emails
          </Link>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(18rem,22rem)_1fr]">
        <Sidebar
          filter={filter}
          counts={counts}
          canEdit={canEdit}
          onFilter={(f) => {
            setFilter(f);
            setSelected(null);
          }}
        />
        <div className="flex min-w-0 flex-col gap-2">
          {checked.size > 0 && canEdit && (
            <BulkBar count={checked.size} onAction={(a, i) => void bulk(a, i)} />
          )}
          <p role="status" className="text-sm">
            {msg}
          </p>
          <ThreadList
            threads={threads}
            selected={selected}
            checked={checked}
            hasMore={!!next}
            loaded={loaded}
            q={filter.q ?? ""}
            attachmentsOnly={!!filter.hasAttachment}
            onSelect={setSelected}
            onCheck={(id, on) =>
              setChecked((s) => {
                const n = new Set(s);
                if (on) n.add(id);
                else n.delete(id);
                return n;
              })
            }
            onCheckAll={(on) => setChecked(on ? new Set(threads.map((t) => t.id)) : new Set())}
            onMore={() => next && void load(next)}
            onSearch={(q) => setFilter({ ...filter, q: q || undefined })}
            onAttachments={(on) => setFilter({ ...filter, hasAttachment: on || undefined })}
          />
        </div>
        <div className="min-w-0">
          {selected ? (
            <ThreadView
              id={selected}
              canEdit={canEdit}
              isAdmin={isAdmin}
              onRead={() => {
                setThreads((ts) => ts.map((t) => (t.id === selected ? { ...t, isRead: true } : t)));
                void refreshCounts();
              }}
              onChanged={changed}
              onDeleted={() => {
                setSelected(null);
                changed();
              }}
            />
          ) : (
            <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Select a conversation to read it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
