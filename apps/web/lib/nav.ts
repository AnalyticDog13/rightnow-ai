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

// Order and labels are fixed by PS-UI-01. `arrives` is the temporary empty-state copy (replaced by each feature task).
export const NAV: { href: string; label: string; icon: LucideIcon; arrives?: string }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Email Accounts", icon: Mail, arrives: "Phase 2 (task P2-T04)" },
  {
    href: "/deliverability",
    label: "Warm-Up & Deliverability",
    icon: Flame,
    arrives: "Phase 5 (task P5-T07)",
  },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, arrives: "Phase 3 (task P3-T12)" },
  { href: "/leads", label: "Leads", icon: Users, arrives: "Phase 3 (task P3-T03)" },
  { href: "/inbox", label: "Unified Inbox", icon: Inbox, arrives: "Phase 4 (task P4-T08)" },
  { href: "/crm", label: "CRM", icon: KanbanSquare },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/automations", label: "Automations", icon: Workflow, arrives: "Phase 7 (task P7-T01)" },
  { href: "/settings", label: "Settings", icon: Settings, arrives: "Phase 7 (task P7-T07)" },
];
