import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

// B4.1. Disabled buttons keep pointer events so the not-allowed cursor shows; below 768 every size is >= 44px.
const button = cva(
  "inline-flex shrink-0 items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors duration-(--dur-1) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground not-disabled:hover:bg-primary-hover not-disabled:active:bg-primary-hover not-disabled:active:shadow-[inset_0_1px_0_rgb(0_0_0/0.2)]",
        outline:
          "border border-border-strong bg-surface text-fg shadow-e1 not-disabled:hover:bg-hover not-disabled:active:bg-active-nav",
        ghost: "text-fg not-disabled:hover:bg-hover not-disabled:active:bg-active-nav",
        destructive:
          "bg-danger-btn text-white not-disabled:hover:bg-[color-mix(in_oklab,var(--danger-btn),black_8%)]",
        "danger-ghost": "text-danger not-disabled:hover:bg-danger-tint",
        link: "text-signal underline-offset-2 not-disabled:hover:underline",
      },
      size: {
        sm: "h-8 gap-1.5 px-2.5 text-[13px]/[18px] max-md:min-h-11 [&_svg]:size-3.5",
        default: "h-9 gap-2 px-3.5 text-sm max-md:min-h-11 [&_svg]:size-4",
        lg: "h-11 gap-2 px-4.5 text-sm [&_svg]:size-4",
        icon: "size-9 max-md:size-11 [&_svg]:size-4",
        "icon-sm": "size-8 max-md:size-11 [&_svg]:size-3.5",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0 max-md:min-h-0" }],
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof button> & { asChild?: boolean; loading?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}

export const buttonClass = button;
