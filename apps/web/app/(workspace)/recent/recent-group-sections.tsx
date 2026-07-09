import type { ReactNode } from "react";

type RecentGroup<T> = {
  label: string;
  items: T[];
};

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
        <section className="recent-group-section" key={group.label}>
          <div className="recent-group-header">
            <span>{group.label}</span>
            <small>{group.items.length}</small>
          </div>

          {group.items.map(renderItem)}
        </section>
      ))}
    </>
  );
}
