import { cn } from "../lib/utils";

/**
 * B4.8 right sheet for a native modal <dialog> (lead, opportunity, rule and webhook editors): 560px by default,
 * full screen below 768. Put a flex column inside with a sticky header, a scrolling body and a footer.
 */
export const sheetClass = (className?: string) =>
  cn(
    "m-0 ml-auto h-dvh max-h-dvh w-screen max-w-none overflow-hidden border-border bg-surface p-0 text-fg shadow-e3 open:animate-sheet-right md:w-[min(560px,100vw)] md:border-l",
    className,
  );

/** B4.8 sheet header: 56px, title left, Close right. */
export const sheetHeader =
  "flex min-h-14 shrink-0 items-center gap-3 border-b border-border py-2 pr-2 pl-5 md:pr-5";
/** B4.8 sheet footer: 64px, actions right, safe-area padding on phones. */
export const sheetFooter =
  "flex min-h-16 shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]";

const WIDTH = {
  480: "md:w-[min(480px,calc(100vw-32px))]",
  640: "md:w-[min(640px,calc(100vw-32px))]",
  800: "md:w-[min(800px,calc(100vw-32px))]",
} as const;

/** B4.9 centered dialog (480 confirmations, 640 forms, 800 wide steps); a bottom sheet below 768. */
export const dialogClass = (width: keyof typeof WIDTH = 640, className?: string) =>
  cn(
    "m-auto w-screen max-w-none overflow-y-auto rounded-xl bg-surface p-6 text-fg shadow-e3 open:animate-pop max-md:mb-0 max-md:max-h-[90dvh] max-md:rounded-b-none md:max-h-[calc(100dvh-64px)]",
    WIDTH[width],
    className,
  );

/** B4.4 tag chip: 20px, radius 4, sunken. */
export const chipClass =
  "inline-flex h-5 max-w-40 items-center truncate rounded-xs border border-border bg-sunken px-1.5 text-xs text-fg-muted";
