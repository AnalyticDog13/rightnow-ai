import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * B4.3: a native checkbox with role="switch", so getByLabel(...).check() keeps working. The label wraps the
 * control; "On"/"Off" is visible text next to the track (hidden from the accessible name: the switch states it).
 */
export function Switch({
  label,
  className,
  checked,
  ...props
}: Omit<ComponentProps<"input">, "type" | "role"> & { label: ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2 text-sm has-disabled:cursor-not-allowed md:min-h-8",
        className,
      )}
    >
      <span className="flex-1">{label}</span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          className="peer h-4.5 w-8 cursor-[inherit] appearance-none rounded-full bg-input transition-colors duration-(--dur-1) checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45"
          {...props}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 left-0.5 size-3.5 rounded-full bg-surface transition-transform duration-(--dur-1) peer-checked:translate-x-3.5"
        />
      </span>
      <span aria-hidden className="w-6 text-[13px]/[18px] text-fg-muted">
        {checked ? "On" : "Off"}
      </span>
    </label>
  );
}
