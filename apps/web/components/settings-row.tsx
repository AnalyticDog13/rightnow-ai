import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { Helper } from "./ui/input";
import { Label } from "./ui/label";

/** B5.15 settings card: an h2 section with an anchor id (the "On this page" nav scrolls to it). */
export function SettingsCard({
  id,
  title,
  status,
  description,
  children,
}: {
  id: string;
  title: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-16 flex-col gap-4 rounded-lg border border-border bg-surface p-4 md:p-5"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            {title}
          </h2>
          {status}
        </div>
        {description && <p className="text-[13px]/[18px] text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * B4.2 field group: label + helper on the left (max half the width), the control on the right, a hairline between
 * rows; stacked below 768. `htmlFor` links the label; the helper is linked by `${htmlFor}-help`.
 */
export function SettingRow({
  htmlFor,
  label,
  helper,
  children,
  className,
}: {
  htmlFor?: string;
  label: ReactNode;
  helper?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-border py-3.5 first:border-t-0 first:pt-0 md:flex-row md:items-start md:gap-6",
        className,
      )}
    >
      <div className="flex flex-col gap-1 md:w-1/2 md:max-w-80 md:shrink-0">
        {htmlFor ? (
          <Label htmlFor={htmlFor}>{label}</Label>
        ) : (
          <span className="text-[13px]/[18px] font-medium">{label}</span>
        )}
        {helper && <Helper id={htmlFor && `${htmlFor}-help`}>{helper}</Helper>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}
