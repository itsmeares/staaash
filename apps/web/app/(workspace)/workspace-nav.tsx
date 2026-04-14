"use client";

import {
  Clock,
  FolderOpen,
  Heart,
  Home,
  Settings,
  Share2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
};

export type WorkspaceNavGroup = {
  label?: string;
  items: WorkspaceNavItem[];
};

export const workspaceNavGroups: WorkspaceNavGroup[] = [
  {
    items: [
      {
        href: "/home",
        label: "Home",
        icon: Home,
      },
      {
        href: "/library",
        label: "Drive",
        icon: FolderOpen,
        matchPrefix: "/library",
      },
    ],
  },
  {
    label: "Collection",
    items: [
      {
        href: "/recent",
        label: "Recent",
        icon: Clock,
      },
      {
        href: "/favorites",
        label: "Favorites",
        icon: Heart,
      },
      {
        href: "/shared",
        label: "Shared",
        icon: Share2,
      },
    ],
  },
  {
    label: "Manage",
    items: [
      {
        href: "/trash",
        label: "Trash",
        icon: Trash2,
      },
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
      },
    ],
  },
];

const isItemActive = (pathname: string, item: WorkspaceNavItem) => {
  const prefix = item.matchPrefix ?? item.href;
  return pathname === item.href || pathname.startsWith(`${prefix}/`);
};

export function WorkspaceNav({ groups }: { groups: WorkspaceNavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="workspace-nav" aria-label="Workspace">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="workspace-nav-group">
          {group.label ? (
            <span className="workspace-nav-label">{group.label}</span>
          ) : null}
          {group.items.map((item) => {
            const active = isItemActive(pathname, item);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                aria-current={active ? "page" : undefined}
                className={`workspace-nav-link${active ? " workspace-nav-link-active" : ""}`}
                href={item.href}
              >
                <Icon
                  className="workspace-nav-icon"
                  size={15}
                  strokeWidth={1.8}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
