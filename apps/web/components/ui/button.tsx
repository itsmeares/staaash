"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 data-loading:text-transparent data-loading:select-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        xs: "h-8 gap-1.5 rounded-md px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-9 gap-1.5 rounded-lg px-3 text-label [&_svg:not([class*='size-'])]:size-4",
        default: "h-11 px-4.5 text-base",
        lg: "h-control px-5 text-base",
        "icon-xs": "size-8 rounded-md [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-9 rounded-lg",
        icon: "size-11 rounded-lg",
        "icon-lg": "size-control",
      },
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 data-pressed:bg-primary/90",
        secondary:
          "bg-primary/10 text-primary-ink hover:bg-primary/16 data-pressed:bg-primary/16",
        outline:
          "border-line-strong bg-card text-foreground hover:bg-hover data-pressed:bg-pressed",
        ghost:
          "text-foreground hover:bg-hover aria-expanded:bg-hover data-pressed:bg-pressed",
        destructive:
          "bg-destructive/12 text-destructive-foreground hover:bg-destructive/18 data-pressed:bg-destructive/18",
        "destructive-outline":
          "border-destructive/30 bg-destructive/6 text-destructive-foreground hover:bg-destructive/12",
        link: "h-auto px-0 text-primary-ink underline-offset-4 hover:underline",
      },
    },
  },
);

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  ...props
}: ButtonProps): React.ReactElement {
  const isDisabled: boolean = Boolean(loading || disabledProp);
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        {children}
        {loading && (
          <Spinner
            className="pointer-events-none absolute"
            data-slot="button-loading-indicator"
          />
        )}
      </>
    ),
    className: cn(buttonVariants({ className, size, variant })),
    "aria-disabled": loading || undefined,
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled: isDisabled,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
