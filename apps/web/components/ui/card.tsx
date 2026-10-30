import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** B2.8: static surface, 1px border, no shadow; radius 12, padding 20 (16 below 768). */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface p-4 md:p-5", className)}
      {...props}
    />
  );
}
