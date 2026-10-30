"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

/** B4.7 tab look, shared by the ARIA Tabs and the link tabs. */
export const tabList =
  "relative flex h-10 shrink-0 gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none]";
export const tabItem = (active: boolean) =>
  cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-t-sm border-b-2 bg-clip-padding px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--dur-1) focus-visible:-outline-offset-2",
    active
      ? "border-signal text-fg"
      : "border-transparent text-fg-muted hover:bg-hover hover:text-fg",
  );

/** Scrolls a tab list sideways so the given tab shows (never scrolls the page). */
export const showTab = (el: HTMLElement | null | undefined) => {
  if (el?.parentElement) el.parentElement.scrollLeft = el.offsetLeft - 24;
};

/**
 * B4.7 link tabs between sibling routes: `<nav aria-label="Section">`, aria-current on the current route, no
 * role="tab" (they navigate). The active tab scrolls into view on narrow screens.
 */
export function SectionTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const current = useRef<HTMLAnchorElement>(null);
  useEffect(() => showTab(current.current), []);
  return (
    <nav aria-label="Section" className={tabList}>
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            ref={active ? current : undefined}
            aria-current={active ? "page" : undefined}
            className={tabItem(active)}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
