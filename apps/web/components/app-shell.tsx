"use client";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { authClient } from "../lib/auth-client";
import { NAV } from "../lib/nav";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";

export function AppShell({
  workspaceName,
  children,
}: {
  workspaceName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
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

  return (
    <div className="min-h-dvh md:flex">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2 md:hidden">
        <span className="font-semibold">RightNow</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </Button>
      </header>
      <aside
        id="sidebar"
        className={cn(
          "flex-col gap-4 border-r border-border bg-card p-4 md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0",
          open ? "flex" : "hidden",
        )}
      >
        <div className="hidden px-2 md:block">
          <p className="text-lg font-semibold">RightNow</p>
          <p className="truncate text-xs text-muted-foreground">{workspaceName}</p>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto">
          <ul className="flex flex-col gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary",
                      active && "bg-muted text-primary",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                    {href === "/inbox" && unread > 0 && (
                      <span
                        aria-label={`${unread} unread`}
                        className="ml-auto rounded-full bg-primary px-2 text-xs text-primary-foreground"
                      >
                        {unread}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={signOut}>
            <LogOut className="size-4" aria-hidden /> Sign out
          </Button>
          <ThemeToggle />
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-8">
        {children}
      </main>
    </div>
  );
}
