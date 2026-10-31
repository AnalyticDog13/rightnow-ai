"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { EmptyState } from "./empty-state";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

// PS-UI-02: the conventions every list table follows: sortable headers (aria-sort), a Next control past one
// page, row selection with a bulk bar that shows the count, and a tag filter.

export type Sort = { col: string; dir: "ascending" | "descending" } | null;
type Key<T> = (r: T) => string | number | null;

/** A first click on a column sorts ascending, a second descending. */
export const nextSort = (s: Sort, col: string): Sort =>
  s?.col === col && s.dir === "ascending" ? { col, dir: "descending" } : { col, dir: "ascending" };

/** Sorts the given rows by one column: a first click sorts ascending, a second descending. Empty values go last. */
export function useSort<T>(rows: T[], keys: Record<string, Key<T>>) {
  const [sort, setSort] = useState<Sort>(null);
  // computed on every render: `keys` closes over props (the assignee name in Tasks), and the lists are small
  const key = sort && keys[sort.col];
  const m = sort?.dir === "descending" ? -1 : 1;
  const sorted = !key
    ? rows
    : [...rows].sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x === y) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : 1) * m;
      });
  const toggle = (col: string) => setSort((s) => nextSort(s, col));
  return { sorted, sort, toggle };
}

export function SortTh({
  col,
  sort,
  onSort,
  children,
  ...th
}: Omit<ComponentProps<"th">, "children"> & {
  col: string;
  sort: Sort;
  onSort: (col: string) => void;
  children: ReactNode;
}) {
  const dir = sort?.col === col ? sort.dir : undefined;
  const Icon = dir === "ascending" ? ArrowUp : dir === "descending" ? ArrowDown : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={dir ?? "none"} {...th}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 rounded-xs uppercase hover:text-fg"
      >
        {children}
        <Icon className={cn("size-3", dir ? "text-fg" : "text-fg-subtle")} aria-hidden />
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
    <nav
      aria-label="Pagination"
      className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2"
    >
      <span className="text-[13px]/[18px] text-fg-muted tabular-nums">
        Page {page + 1} of {pages}
      </span>
      <span className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous page
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          Next page
        </Button>
      </span>
    </nav>
  );
}

/** The "Next page" control of a cursor-paged list (it appends the next page to the rows shown). */
export function NextPage({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="self-start" onClick={onClick}>
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

/**
 * B4.6 bulk bar: an inverse bar that replaces the toolbar row while rows are selected. Buttons inside it render as
 * inverse ghost buttons; selects and inputs keep their own box.
 */
export function BulkToolbar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="sticky top-0 z-(--z-sticky) flex min-h-12 flex-wrap items-center gap-1 rounded-md bg-fg py-1.5 pr-2 pl-3 text-bg md:top-12 [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-bg [&_button]:shadow-none [&_button:not(:disabled):hover]:bg-white/12 dark:[&_button:not(:disabled):hover]:bg-black/12"
    >
      <span className="mr-1 text-sm font-medium tabular-nums">{count} selected</span>
      {onClear && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
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
    <Select
      size="sm"
      aria-label="Filter by tag"
      className="w-auto"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All tags</option>
      {tags.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </Select>
  );
}

/** B4.6 toolbar search: 240px with a leading Search icon, full width below 640. */
export function SearchInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <span className={cn("relative w-full sm:w-60", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-muted"
        aria-hidden
      />
      <Input type="search" className="pl-8 md:h-8 md:text-[13px]/[18px]" {...props} />
    </span>
  );
}

/**
 * B4.6 table frame: radius 12, its own horizontal scroll (the page never scrolls sideways), mono uppercase headers,
 * hairline rows. Row hooks: `aria-selected` (signal tint + stripe), `data-stripe="warning" | "danger"` (object in a
 * bad state; duplicates its pill). Cell hooks: `data-pin="check"` / `data-pin="id"` keep the checkbox and
 * identity cells in view below 768. `footer` holds the Pager.
 */
export function TableFrame({
  children,
  footer,
  className,
  label,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** for a table with no focusable cells: makes the scroll region a named tab stop so keyboard users can scroll it */
  label?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div
        className="table-frame relative overflow-x-auto"
        {...(label && { tabIndex: 0, role: "region", "aria-label": label })}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

/** B4.6 empty state inside a table: one full-width row. */
export function TableEmpty({
  colSpan,
  ...props
}: { colSpan: number } & ComponentProps<typeof EmptyState>) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState {...props} />
      </td>
    </tr>
  );
}
