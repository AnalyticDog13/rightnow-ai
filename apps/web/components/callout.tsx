import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

const TONE = {
  info: { icon: Info, box: "bg-info-tint border-info-solid/30", fg: "text-info", role: "note" },
  neutral: {
    icon: Info,
    box: "bg-neutral-tint border-neutral-solid/30",
    fg: "text-neutral",
    role: "note",
  },
  success: {
    icon: CheckCircle2,
    box: "bg-success-tint border-success-solid/30",
    fg: "text-success",
    role: "status",
  },
  warning: {
    icon: AlertTriangle,
    box: "bg-warning-tint border-warning-solid/30",
    fg: "text-warning",
    role: "note",
  },
  danger: {
    icon: AlertCircle,
    box: "bg-danger-tint border-danger-solid/30",
    fg: "text-danger",
    role: "note",
  },
} as const;

/**
 * B4.11 inline notice: honest-limits copy, warnings next to fields, errors above tables. Pass `role="alert"` only
 * when it appears in response to a user action.
 */
export function Callout({
  tone = "info",
  title,
  children,
  action,
  role,
  className,
}: {
  tone?: keyof typeof TONE;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: "note" | "status" | "alert";
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      role={role ?? t.role}
      className={cn("flex gap-2.5 rounded-md border px-3.5 py-3 text-fg", t.box, className)}
    >
      <t.icon className={cn("mt-0.5 size-4 shrink-0", t.fg)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <p className="text-sm font-medium">{title}</p>}
        {children && <div className="text-[13px]/[18px]">{children}</div>}
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  );
}
