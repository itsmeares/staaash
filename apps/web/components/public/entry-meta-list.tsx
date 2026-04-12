import { Fragment } from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type EntryMetaItem = {
  label: string;
  value: string;
};

type EntryMetaListProps = {
  items: EntryMetaItem[];
  className?: string;
};

export function EntryMetaList({ items, className }: EntryMetaListProps) {
  return (
    <dl
      className={cn(
        "rounded-[2rem] border border-border/70 bg-card/75 p-5 shadow-[0_26px_70px_rgba(3,11,16,0.18)]",
        className,
      )}
    >
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? <Separator className="my-4" /> : null}
          <div className="flex items-start justify-between gap-6">
            <dt className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--entry-accent-ink)]">
              {item.label}
            </dt>
            <dd className="max-w-[18rem] text-right text-sm leading-6 text-muted-foreground">
              {item.value}
            </dd>
          </div>
        </Fragment>
      ))}
    </dl>
  );
}
