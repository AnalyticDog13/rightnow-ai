import type { ReactNode } from "react";

/**
 * B3.3 / B4.18: the one H1 of a page, an optional status pill, a short description, right-aligned actions (at most
 * one primary) and optional section tabs (SectionTabs; ARIA Tabs stay in the page body because they own panels).
 * Below 768 the actions wrap under the title: one fills the width, two share it.
 */
export function PageHeader({
  title,
  description,
  status,
  actions,
  tabs,
}: {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-h-9 flex-wrap items-center gap-3">
            <h1 className="text-xl/7 font-semibold tracking-[-0.01em] md:text-2xl/8">{title}</h1>
            {status}
          </div>
          {description && (
            <p className="max-w-[72ch] text-[13px]/[18px] text-fg-muted">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-start gap-2 max-md:[&>*]:flex-1">
            {actions}
          </div>
        )}
      </div>
      {tabs}
    </header>
  );
}
