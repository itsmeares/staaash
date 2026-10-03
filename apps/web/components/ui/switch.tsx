"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type React from "react";

import { cn } from "@/lib/utils";

export function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-6.5 w-11 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:border-primary data-checked:bg-primary data-unchecked:border-line-strong data-unchecked:bg-hairline data-disabled:cursor-not-allowed data-disabled:opacity-60",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block size-5 rounded-full bg-card shadow-xs transition-transform duration-150 data-checked:translate-x-4.5 data-unchecked:bg-muted-foreground/80"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { SwitchPrimitive };
