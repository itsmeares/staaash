import type { ReactNode } from "react";

import { SectionLabel } from "@/components/section-label";

type RecentGroup<T> = {
  label: string;
  items: T[];
};

export function RecentGroupHeader({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 px-1 pt-5 pb-2.5 group-first-of-type/group:pt-2 lg:gap-2.5 lg:px-1.5 lg:pt-6.5 lg:pb-3 lg:group-first-of-type/group:pt-2.5">
      <SectionLabel>{label}</SectionLabel>
      <span className="text-label font-medium text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

export function RecentGroupSections<T>({
  groups,
  renderItem,
}: {
  groups: RecentGroup<T>[];
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <>
      {groups.map((group) => (
        <section className="group/group grid" key={group.label}>
          <RecentGroupHeader label={group.label} count={group.items.length} />

          {group.items.map(renderItem)}
        </section>
      ))}
    </>
  );
}
