"use client";

import { cn } from "@/lib/utils";

/** A row of chips that filters a list by type. */
export function TypeFilter<T extends string>({
  options,
  value,
  onValueChange,
  label = "Filter by type",
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onValueChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div
      aria-label={label}
      className="-mx-1 flex min-w-0 [scrollbar-width:none] gap-1.5 overflow-x-auto px-1 py-0.5"
      role="radiogroup"
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            aria-checked={active}
            className={cn(
              "h-7 shrink-0 cursor-pointer rounded-md border border-input px-2.5 text-meta font-medium whitespace-nowrap text-foreground transition-colors duration-150 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              active &&
                "border-transparent bg-popover shadow-raised ring-1 ring-border hover:bg-popover dark:bg-accent",
            )}
            key={option.id}
            role="radio"
            type="button"
            onClick={() => onValueChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
