"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/utils";

/** WAI-ARIA tabs with automatic activation: arrow keys, Home and End move between tabs (one tab stop). */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
  children,
}: {
  label: string;
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const i = tabs.findIndex((t) => t.id === value);

  function onKey(e: KeyboardEvent) {
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to]!.id);
    refs.current[tabs[to]!.id]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKey}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls={t.id === value ? `panel-${t.id}` : undefined}
            tabIndex={t.id === value ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary",
              t.id === value
                ? "border-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`}>
        {children}
      </div>
    </div>
  );
}
