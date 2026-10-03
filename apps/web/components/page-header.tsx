import type * as React from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra content next to the title, such as a count badge. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Larger title for admin and settings surfaces. */
  size?: "default" | "lg";
  /** Draw a hairline under the header. */
  divider?: boolean;
  className?: string;
};

export function PageHeader({
  title,
  description,
  meta,
  actions,
  size = "default",
  divider = false,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4.5 gap-y-3 max-sm:flex-col",
        divider && "border-b border-hairline pb-4",
        className,
      )}
      data-slot="page-header"
    >
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1
            className={cn(
              "m-0 font-heading leading-tight font-semibold tracking-tight text-foreground",
              size === "default" ? "text-headline" : "text-3xl",
            )}
          >
            {title}
          </h1>
          {meta}
        </div>
        {description ? (
          <p className="m-0 max-w-[64ch] text-meta text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
