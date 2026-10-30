import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** B4.2 control box, shared by Input, Select and Textarea. 16px text below 768 so iOS does not zoom. */
export const field =
  "w-full rounded-sm border border-input bg-surface text-base text-fg transition-colors duration-(--dur-1) hover:border-fg-muted focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-disabled aria-invalid:border-danger-solid md:text-sm";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input className={cn(field, "h-11 px-2.5 read-only:bg-sunken md:h-9", className)} {...props} />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-22 resize-y px-2.5 py-2", className)} {...props} />;
}

/** Helper line under a control: "Recommended 30 per day". Link it with aria-describedby. */
export function Helper({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[13px]/[18px] text-fg-subtle", className)} {...props} />;
}
