import type * as React from "react";

import { cn } from "@/lib/utils";

/** Short uppercase structural label, for sidebar groups and list sections. */
export function SectionLabel({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-label font-medium tracking-wider text-muted-foreground uppercase",
        className,
      )}
      data-slot="section-label"
      {...props}
    />
  );
}
