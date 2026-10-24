"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "./ui/button";

// PS-UI-02: the conventions every list table follows: sortable headers (aria-sort), a Next control past one
// page, row selection with a bulk bar that shows the count, and a tag filter.

export type Sort = { col: string; dir: "ascending" | "descending" } | null;
type Key<T> = (r: T) => string | number | null;

/** Sorts the given rows by one column: a first click sorts ascending, a second descending. Empty values go last. */
export function useSort<T>(rows: T[], keys: Record<string, Key<T>>) {
  const [sort, setSort] = useState<Sort>(null);
  const sorted = useMemo(() => {
    const key = sort && keys[sort.col];
    if (!sort || !key) return rows;
    const m = sort.dir === "ascending" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * m;
    });
    // `keys` is a literal rebuilt every render; the column name identifies it
  }, [rows, sort]);
  const toggle = (col: string) =>
    setSort((s) =>
      s?.col === col && s.dir === "ascending"
        ? { col, dir: "descending" }
        : { col, dir: "ascending" },
    );
  return { sorted, sort, toggle };
}

export function SortTh({
  col,
  sort,
  onSort,
  children,
}: {
  col: string;
  sort: Sort;
  onSort: (col: string) => void;
  children: ReactNode;
}) {
  const dir = sort?.col === col ? sort.dir : undefined;
  return (
    <th scope="col" aria-sort={dir ?? "none"} className="p-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-primary"
      >
        {children}
        {dir === "ascending" && <ArrowUp className="size-3" aria-hidden />}
        {dir === "descending" && <ArrowDown className="size-3" aria-hidden />}
      </button>
    </th>
  );
}

/** Client-side pages for a list that is already fully loaded. */
export function usePage<T>(rows: T[], size = 25) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => setPage((p) => Math.min(p, pages - 1)), [pages]);
  return { rows: rows.slice(page * size, (page + 1) * size), page, pages, setPage };
}

export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) {
  if (pages < 2) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center gap-2 text-sm">
      <Button variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>
        Previous page
      </Button>
      <span>
        Page {page + 1} of {pages}
      </span>
      <Button variant="outline" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        Next page
      </Button>
    </nav>
  );
}

/** The "Next page" control of a cursor-paged list (it appends the next page to the rows shown). */
export function NextPage({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" className="self-start" onClick={onClick}>
      Next page
    </Button>
  );
}

export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const setAll = (ids: string[], on: boolean) => setSelected(on ? new Set(ids) : new Set());
  return { selected, toggle, setAll, clear: () => setSelected(new Set()) };
}

export function BulkToolbar({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
    >
      <span className="text-sm font-medium">{count} selected</span>
      {children}
    </div>
  );
}

/** A select of the tags in use (GET /tags); the empty value means every tag. */
export function TagSelect({
  kind,
  value,
  onChange,
}: {
  kind: "account" | "campaign" | "lead";
  value: string;
  onChange: (tag: string) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    void fetch(`/api/v1/tags?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((j: { tags: string[] }) => setTags(j.tags))
      .catch(() => {});
  }, [kind]);
  return (
    <select
      aria-label="Filter by tag"
      className="h-10 rounded-md border border-border bg-card px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All tags</option>
      {tags.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
  );
}
