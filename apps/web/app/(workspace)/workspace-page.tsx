import type * as React from "react";

import { cn } from "@/lib/utils";

export function WorkspacePage({
  as: Tag = "div",
  className,
  ...props
}: React.ComponentProps<"div"> & { as?: "div" | "main" | "section" }) {
  return (
    <Tag
      className={cn("grid gap-5.5 max-lg:min-w-0", className)}
      data-slot="workspace-page"
      {...props}
    />
  );
}
