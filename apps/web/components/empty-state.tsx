import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * B4.14. `inline` sits inside a table, list or board column (centered); `page` is the first-run state of a screen
 * (left-aligned, with ActionCards as its actions). The title says what is missing, the body the next step.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  actions,
  variant = "inline",
}: {
  icon?: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  variant?: "inline" | "page";
}) {
  if (variant === "page")
    return (
      <div className="flex max-w-160 flex-col gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {body && <p className="text-[13px]/[18px] text-fg-muted">{body}</p>}
        {actions && <div className="mt-3 flex flex-col gap-2">{actions}</div>}
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {Icon && (
        <span className="mb-1 grid size-10 place-items-center rounded-full bg-sunken">
          <Icon className="size-5 text-fg-muted" aria-hidden />
        </span>
      )}
      <h2 className="text-base font-semibold">{title}</h2>
      {body && <p className="max-w-[48ch] text-[13px]/[18px] text-fg-muted">{body}</p>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** One 72px action card of a page empty state: the whole card is one button. */
export function ActionCard({
  icon: Icon,
  title,
  description,
  className,
  ...props
}: ComponentProps<"button"> & { icon: LucideIcon; title: ReactNode; description: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-18 w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors duration-(--dur-1) not-disabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-sunken">
        <Icon className="size-4 text-fg-muted" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[13px]/[18px] text-fg-muted">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
    </button>
  );
}
