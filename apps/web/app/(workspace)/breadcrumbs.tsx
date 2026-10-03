import Link from "next/link";
import type * as React from "react";

import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  id: string;
  label: string;
  href: string;
  /** Highlight the crumb while an item is dragged over it. */
  isDropTarget?: boolean;
  onDragOver?: (event: React.DragEvent<HTMLAnchorElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLAnchorElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLAnchorElement>) => void;
};

/** Path links ending in the current location, rendered as the page title. */
export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex flex-wrap items-baseline", className)}
    >
      {items.map((item, index) => {
        if (index === items.length - 1) {
          return (
            <span
              key={item.id}
              className="m-0 font-heading text-headline leading-tight font-semibold tracking-tight text-foreground max-xs:text-xl"
            >
              {item.label}
            </span>
          );
        }
        return (
          <Link
            key={item.id}
            className={cn(
              "text-label text-muted-foreground/65 transition-colors duration-150 after:px-1.75 after:font-light after:text-muted-foreground/30 after:content-['/'] hover:text-muted-foreground motion-reduce:transition-none",
              item.isDropTarget && "text-foreground",
            )}
            href={item.href}
            onDragOver={item.onDragOver}
            onDragLeave={item.onDragLeave}
            onDrop={item.onDrop}
          >
            <span
              className={cn(
                "rounded-xs",
                item.isDropTarget && "bg-primary/12 ring-2 ring-primary/45",
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
