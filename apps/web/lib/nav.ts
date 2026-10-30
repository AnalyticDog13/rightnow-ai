import {
  BarChart3,
  Flame,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  Megaphone,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

// Order and labels are fixed by PS-UI-01. `group` is the sidebar group label (B3.2); `also` are the sub-routes
// that mark the item as current.
export const NAV: {
  href: string;
  label: string;
  icon: LucideIcon;
  group?: "Outreach" | "Conversations" | "Insight";
  also?: string[];
}[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Email Accounts", icon: Mail, group: "Outreach" },
  { href: "/deliverability", label: "Warm-Up & Deliverability", icon: Flame, group: "Outreach" },
  {
    href: "/campaigns",
    label: "Campaigns",
    icon: Megaphone,
    group: "Outreach",
    also: ["/scheduled"],
  },
  { href: "/leads", label: "Leads", icon: Users, group: "Outreach", also: ["/blocklist"] },
  { href: "/inbox", label: "Unified Inbox", icon: Inbox, group: "Conversations" },
  { href: "/crm", label: "CRM", icon: KanbanSquare, group: "Conversations" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, group: "Insight" },
  { href: "/automations", label: "Automations", icon: Workflow, group: "Insight" },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** A nav item is current on its own route, its sub-routes (/campaigns/x) and the sibling routes in `also`. */
export const isCurrent = (item: (typeof NAV)[number], pathname: string) =>
  [item.href, ...(item.also ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`));
