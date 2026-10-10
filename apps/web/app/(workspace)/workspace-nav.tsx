"use client";

import {
  ArrowLeft,
  Clock,
  FolderOpen,
  HardDrive,
  Heart,
  Home,
  LayoutDashboard,
  ListChecks,
  Settings,
  Share2,
  Shield,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Also active on every path below this prefix. */
  matchPrefix?: string;
  /** Active only on the exact path. */
  exact?: boolean;
};

export const driveNavItems: WorkspaceNavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/files", label: "Files", icon: FolderOpen, matchPrefix: "/files" },
  { href: "/recent", label: "Recent", icon: Clock },
  { href: "/favorites", label: "Favorites", icon: Heart },
  { href: "/shared", label: "Shared", icon: Share2 },
  { href: "/trash", label: "Trash", icon: Trash2 },
];

export const adminNavItems: WorkspaceNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/storage", label: "Storage", icon: HardDrive },
  { href: "/admin/jobs", label: "Jobs", icon: ListChecks },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export const adminLinkItem: WorkspaceNavItem = {
  href: "/admin",
  label: "Admin",
  icon: Shield,
};

export const backToDriveItem: WorkspaceNavItem = {
  href: "/files",
  label: "Back to drive",
  icon: ArrowLeft,
};

export const isItemActive = (pathname: string, item: WorkspaceNavItem) => {
  if (pathname === item.href) return true;
  if (item.exact) return false;
  return pathname.startsWith(`${item.matchPrefix ?? item.href}/`);
};

export const isAdminPath = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/");

const itemClass =
  "relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-body text-foreground outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/** A plain sidebar link, for items outside the main list. */
export function SidebarLink({ item }: { item: WorkspaceNavItem }) {
  const Icon = item.icon;
  return (
    <Link className={itemClass} href={item.href}>
      <Icon aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/**
 * Sidebar list with the shared raised pill under the active item. The pill
 * glides between items; before it is measured, the active link draws its own
 * pill so the first paint is right.
 */
export function SidebarNav({
  items,
  label,
}: {
  items: WorkspaceNavItem[];
  label: string;
}) {
  const pathname = usePathname();
  const listRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(
    null,
  );
  const activeHref = items.find((item) => isItemActive(pathname, item))?.href;

  useLayoutEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    setPill(
      active ? { top: active.offsetTop, height: active.offsetHeight } : null,
    );
  }, [activeHref]);

  return (
    <nav
      ref={listRef}
      aria-label={label}
      className="group/nav relative flex flex-col gap-px"
      data-ready={pill ? "" : undefined}
    >
      {pill ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 rounded-lg bg-card shadow-raised ring-1 ring-border transition-[translate,height] duration-270 ease-slide motion-reduce:transition-none"
          style={{ height: pill.height, translate: `0 ${pill.top}px` }}
        />
      ) : null}
      {items.map((item) => {
        const active = item.href === activeHref;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              itemClass,
              active &&
                "font-semibold not-group-data-ready/nav:bg-card not-group-data-ready/nav:shadow-raised not-group-data-ready/nav:ring-1 not-group-data-ready/nav:ring-border hover:bg-transparent [&_svg]:text-primary",
            )}
            href={item.href}
          >
            <Icon aria-hidden />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
