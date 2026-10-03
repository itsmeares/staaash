"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 rounded-full border border-transparent font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [a&,button&]:cursor-pointer",
  {
    defaultVariants: {
      size: "default",
      variant: "neutral",
    },
    variants: {
      size: {
        sm: "h-5 px-2 text-xs",
        default: "h-6 px-2.5 text-xs",
        lg: "h-6.5 px-3 text-label",
      },
      variant: {
        default: "bg-primary text-primary-foreground",
        accent: "bg-primary/12 text-primary-ink",
        neutral: "bg-hairline text-muted-foreground",
        outline: "border-line-strong text-foreground",
        success: "bg-success/14 text-success-foreground dark:bg-success/16",
        info: "bg-info/14 text-info-foreground dark:bg-info/16",
        warning: "bg-warning/16 text-warning-foreground dark:bg-warning/17",
        error:
          "bg-destructive/14 text-destructive-foreground dark:bg-destructive/16",
      },
    },
  },
);

export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}

export function Badge({
  className,
  variant,
  size,
  render,
  ...props
}: BadgeProps): React.ReactElement {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}
