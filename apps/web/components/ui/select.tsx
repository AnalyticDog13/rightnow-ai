import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { field } from "./input";

/**
 * B4.2 native select (keyboard and screen-reader safe) in the Input box. `size="sm"` is the 32px toolbar filter.
 * `className` goes to the wrapper (width, margins); the select fills it.
 */
export function Select({
  className,
  size = "default",
  ...props
}: Omit<ComponentProps<"select">, "size"> & { size?: "default" | "sm" }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        className={cn(
          field,
          "appearance-none pr-7.5 pl-2.5",
          size === "sm" ? "h-11 md:h-8 md:text-[13px]/[18px]" : "h-11 md:h-9",
        )}
        {...props}
      />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-fg-muted"
        aria-hidden
      />
    </span>
  );
}
