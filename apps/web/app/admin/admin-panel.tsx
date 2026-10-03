import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Bordered surface used by admin overview, storage, users and jobs. */
export function AdminPanel({
  title,
  aside,
  className,
  children,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: string;
  aside?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 grid-cols-1 gap-3.5 rounded-lg border border-hairline bg-card p-4.5",
        className,
      )}
      {...props}
    >
      {title ? (
        <div className="flex items-baseline justify-between gap-3.5">
          <h2 className="m-0 font-heading text-lg leading-tight font-semibold text-foreground">
            {title}
          </h2>
          {aside ? (
            <p className="m-0 text-right text-meta text-muted-foreground">
              {aside}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
