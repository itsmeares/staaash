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

import { SectionLabel } from "@/components/section-label";
import { cn } from "@/lib/utils";

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
        href: "/files",
        label: "Files",
        icon: FolderOpen,
        matchPrefix: "/files",
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

export function WorkspaceNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-1 flex-col gap-1 md:max-lg:landscape:gap-0.5"
      aria-label="Workspace"
    >
      {workspaceNavGroups.map((group, groupIndex) => (
        <div key={groupIndex} className="mb-4.5 flex flex-col gap-0.75">
          {group.label ? (
            <SectionLabel className="block px-3 pt-1.5 pb-2 md:max-lg:landscape:hidden">
              {group.label}
            </SectionLabel>
          ) : null}
          {group.items.map((item) => {
            const active = isItemActive(pathname, item);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-control items-center gap-3 rounded-md px-3.5 text-base font-medium transition-colors duration-150 motion-reduce:transition-none md:max-lg:landscape:min-h-row-sm md:max-lg:landscape:justify-center md:max-lg:landscape:px-0",
                  active
                    ? "bg-primary/10 font-semibold text-primary-ink hover:bg-primary/12"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground/90",
                )}
                href={item.href}
              >
                <Icon
                  className={cn("size-5 shrink-0", active ? "" : "opacity-70")}
                  size={20}
                  strokeWidth={1.9}
                />
                <span className="md:max-lg:landscape:hidden">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
