"use client";

import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { authClient } from "../lib/auth-client";
import { isCurrent, NAV } from "../lib/nav";
import { cn } from "../lib/utils";
import { CommandPalette, isMac, useCommandPalette } from "./command-palette";
import { SendMeter, useSendSummary } from "./send-meter";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";

const GROUPS = ["Outreach", "Conversations", "Insight"] as const;
const KEY = "rn.sidebar";

/**
 * B3.2 / B3.6 app shell. DOM order: (skip link) -> mobile top bar (hidden >= 768) -> sidebar (brand, Main nav, send
 * meter, footer) -> content (top strip, main). Nothing focusable sits above the nav in the sidebar on desktop.
 * Sidebar: 232px >= 1280 (the user may collapse it to the 64px rail, stored in localStorage), rail at 768-1279
 * ("Expand sidebar" opens it as an overlay), a left drawer below 768.
 */
export function AppShell({
  workspaceName,
  children,
}: {
  workspaceName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false); // mobile drawer
  const [overlay, setOverlay] = useState(false); // tablet: full sidebar over the content
  const [collapsed, setCollapsed] = useState(false); // desktop: the user's rail choice
  const [wide, setWide] = useState(true); // >= 1280
  const [kbd, setKbd] = useState("Ctrl K");
  const menuButton = useRef<HTMLButtonElement>(null);
  const railButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const palette = useCommandPalette();
  const summary = useSendSummary();

  useEffect(() => {
    setOpen(false);
    setOverlay(false);
  }, [pathname]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === "rail");
    } catch {
      /* storage blocked: the default applies */
    }
    if (isMac()) setKbd("⌘K");
    const mq = window.matchMedia("(min-width: 80rem)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // drawer / overlay: Escape closes and focus returns to the opener; the drawer locks page scroll and takes focus
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open && !overlay) {
      opener.current?.focus();
      opener.current = null;
      return;
    }
    opener.current = open ? menuButton.current : railButton.current;
    if (open) {
      sidebar.current?.querySelector<HTMLElement>("nav a")?.focus();
      document.body.style.overflow = "hidden";
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      setOverlay(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, overlay]);

  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const load = () =>
      fetch("/api/v1/inbox/unread-count")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { primary?: number } | null) => j && setUnread(j.primary ?? 0))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    window.addEventListener("inbox:unread-changed", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("inbox:unread-changed", load);
    };
  }, []);

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
  }

  const expanded = wide ? !collapsed : overlay;
  function toggleRail() {
    if (!wide) return setOverlay(!overlay);
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(KEY, collapsed ? "full" : "rail");
    } catch {
      /* not persisted */
    }
  }

  const link = (item: (typeof NAV)[number]) => {
    const active = isCurrent(item, pathname);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group/item relative flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-sm font-medium text-fg transition-colors duration-(--dur-1) hover:bg-hover focus-visible:-outline-offset-2 max-md:h-11 rail:justify-center rail:px-0",
            active &&
              "bg-active-nav before:absolute before:top-1/2 before:left-0 before:h-4 before:w-0.75 before:-translate-y-1/2 before:rounded-r-full before:bg-signal",
          )}
        >
          <item.icon
            className={cn("size-4 shrink-0", active ? "text-fg" : "text-fg-muted")}
            aria-hidden
          />
          {/* in the rail the label stays in the DOM (the link text) and shows as a tooltip on hover/focus */}
          <span className="truncate rail:pointer-events-none rail:absolute rail:left-full rail:z-(--z-popover) rail:ml-3 rail:rounded-sm rail:bg-fg rail:px-2 rail:py-1.5 rail:text-xs rail:font-normal rail:text-bg rail:opacity-0 rail:shadow-e2 rail:group-hover/item:opacity-100 rail:group-focus-visible/item:opacity-100">
            {item.label}
          </span>
          {item.href === "/inbox" && unread > 0 && (
            <span
              aria-label={`${unread} unread`}
              className="ml-auto min-w-4.5 rounded-full bg-signal px-1.25 text-center font-mono text-[11px]/[18px] font-medium text-white tabular-nums dark:text-bg rail:absolute rail:top-0.5 rail:right-1.5 rail:ml-0"
            >
              {unread}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className="min-h-dvh md:flex">
      <header
        inert={open || undefined}
        className="sticky top-0 z-(--z-topbar) flex h-14 items-center gap-1 border-b border-border bg-surface px-1 md:hidden"
      >
        <Button
          ref={menuButton}
          variant="ghost"
          size="icon"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(!open)}
        >
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </Button>
        <span className="flex-1 text-sm font-medium">rightnow</span>
        <SendMeter summary={summary} variant="chip" />
        <Button variant="ghost" size="icon" aria-label="Search or jump to" onClick={palette.open}>
          <Search aria-hidden />
        </Button>
      </header>

      {(open || overlay) && (
        <div
          aria-hidden
          onClick={() => {
            setOpen(false);
            setOverlay(false);
          }}
          className="fixed inset-0 z-(--z-drawer) bg-(--overlay) xl:hidden"
        />
      )}
      {/* keeps the content in place while the tablet overlay takes the sidebar out of the flow */}
      {overlay && <div className="hidden w-16 shrink-0 md:block xl:hidden" />}

      <aside
        id="sidebar"
        ref={sidebar}
        data-collapsed={collapsed || undefined}
        data-overlay={overlay || undefined}
        className={cn(
          "sb flex-col border-r border-border bg-sunken",
          open
            ? "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-(--z-drawer) max-md:flex max-md:w-[min(300px,85vw)] max-md:animate-sheet-left max-md:shadow-e3"
            : "max-md:hidden",
          "md:sticky md:top-0 md:z-(--z-sidebar) md:flex md:h-dvh md:w-58 md:shrink-0 rail:w-16",
          overlay &&
            "md:max-xl:fixed md:max-xl:left-0 md:max-xl:z-(--z-drawer) md:max-xl:animate-sheet-left md:max-xl:shadow-e3",
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4 rail:justify-center rail:px-0">
          <img src="/rightnow-logo.svg" alt="" className="size-7 shrink-0 rounded-sm border border-border" />
          <span className="flex min-w-0 flex-1 flex-col rail:hidden">
            <span className="text-sm font-medium">rightnow</span>
            <span title={workspaceName} className="truncate text-[13px]/[18px] text-fg-muted">
              {workspaceName}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close menu"
            className="md:hidden"
            onClick={() => setOpen(false)}
          >
            <X aria-hidden />
          </Button>
        </div>

        <nav
          aria-label="Main"
          className="flex flex-1 flex-col overflow-y-auto px-2 pb-2 rail:overflow-visible"
        >
          <ul className="flex flex-col gap-0.5">
            {NAV.filter((n) => !n.group && n.href !== "/settings").map(link)}
          </ul>
          {GROUPS.map((g) => (
            <div key={g}>
              <p
                id={`nav-g-${g.toLowerCase()}`}
                className="micro px-2.5 pt-4 pb-1 text-fg-subtle rail:hidden"
              >
                {g}
              </p>
              <ul
                aria-labelledby={`nav-g-${g.toLowerCase()}`}
                className="flex flex-col gap-0.5 rail:mt-3 rail:border-t rail:border-border rail:pt-3"
              >
                {NAV.filter((n) => n.group === g).map(link)}
              </ul>
            </div>
          ))}
          <ul className="mt-auto flex flex-col gap-0.5 border-t border-border pt-2">
            {NAV.filter((n) => n.href === "/settings").map(link)}
          </ul>
        </nav>

        <div className="px-4 pb-3 rail:hidden">
          <SendMeter summary={summary} />
        </div>
        <div className="hidden justify-center pb-3 rail:flex">
          <SendMeter summary={summary} variant="rail" />
        </div>

        <div className="flex h-12 shrink-0 items-center gap-1 border-t border-border px-2 rail:h-auto rail:flex-col rail:py-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={signOut} className="rail:size-9 rail:px-0">
            <LogOut aria-hidden />
            <span className="rail:sr-only">Sign out</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            ref={railButton}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={expanded}
            aria-controls="sidebar"
            onClick={toggleRail}
            className="ml-auto max-md:hidden rail:ml-0"
          >
            {expanded ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
          </Button>
        </div>
      </aside>

      <div inert={open || (overlay && !wide) || undefined} className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-(--z-topbar) hidden h-12 shrink-0 items-center justify-end border-b border-border bg-bg px-6 md:flex xl:px-8">
          <button
            type="button"
            onClick={palette.open}
            aria-label="Search or jump to"
            className="flex h-8 w-60 items-center gap-2 rounded-sm border border-border-strong bg-surface px-2.5 text-[13px]/[18px] shadow-e1 transition-colors duration-(--dur-1) hover:bg-hover"
          >
            <Search className="size-3.5 text-fg-muted" aria-hidden />
            <span className="flex-1 text-left text-fg-subtle">Search or jump to...</span>
            <kbd
              aria-hidden
              className="rounded-xs border border-border bg-sunken px-1.5 font-mono text-[11px]/4 font-medium text-fg-muted"
            >
              {kbd}
            </kbd>
          </button>
        </div>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 outline-none md:px-6 xl:px-8"
        >
          {children}
        </main>
      </div>
      <CommandPalette dialogRef={palette.ref} />
    </div>
  );
}
