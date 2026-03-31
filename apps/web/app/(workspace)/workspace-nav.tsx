"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type WorkspaceNavItem = {
  href: string;
  label: string;
  matchPrefix?: string;
};

const isItemActive = (pathname: string, item: WorkspaceNavItem) => {
  const prefix = item.matchPrefix ?? item.href;

  return pathname === item.href || pathname.startsWith(`${prefix}/`);
};

export function WorkspaceNav({ items }: { items: WorkspaceNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="workspace-nav" aria-label="Workspace">
      {items.map((item) => {
        const active = isItemActive(pathname, item);

        return (
          <Link
            key={item.href}
            aria-current={active ? "page" : undefined}
            className={`workspace-nav-link${active ? " workspace-nav-link-active" : ""}`}
            href={item.href}
          >
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
