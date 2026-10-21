import { cn } from "../../../lib/utils";

const TONE: Record<string, string> = {
  Active: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  Paused: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  "Accounts Unhealthy": "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  "Bounce Protect": "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

/** PS-UI-06: the campaign's display status as a labelled pill (text, not colour alone). */
export const StatusBadge = ({ status }: { status: string }) => (
  <span
    className={cn(
      "rounded-full px-2 py-0.5 text-xs font-medium",
      TONE[status] ?? "bg-muted text-foreground",
    )}
  >
    {status}
  </span>
);
