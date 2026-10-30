"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { showTab, tabItem, tabList } from "./section-tabs";

/**
 * WAI-ARIA tabs with automatic activation: arrow keys, Home and End move between tabs (one tab stop). A tab may show
 * a count (aria-hidden: tab names are matched exactly) and a "needs attention" dot.
 */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
  children,
}: {
  label: string;
  tabs: { id: string; label: string; count?: number; attention?: boolean }[];
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const i = tabs.findIndex((t) => t.id === value);
  // on mount only: a narrow tab list shows the active tab
  useEffect(() => showTab(refs.current[value]), []);

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
      <div role="tablist" aria-label={label} onKeyDown={onKey} className={tabList}>
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
            className={tabItem(t.id === value)}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                aria-hidden
                className="min-w-4.5 rounded-full bg-sunken px-1.25 font-mono text-[11px]/[18px] font-medium text-fg-muted"
              >
                {t.count}
              </span>
            )}
            {t.attention && <span aria-hidden className="size-1.5 rounded-full bg-warning-solid" />}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`}>
        {children}
      </div>
    </div>
  );
}
