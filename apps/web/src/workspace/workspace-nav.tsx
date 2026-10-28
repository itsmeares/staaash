import { useLocation } from "@tanstack/react-router";
import { useRefresh } from "@/lib/use-refresh";
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
import { AppLink } from "@/components/app-link";

import { GlidingPill, useGlidingPill } from "@/components/gliding-pill";
import { ItemIcon, thumbnailUrlFor } from "@/components/file-list/file-list";
import { cn } from "@staaash/ui/utils";

import { toastManager } from "@staaash/ui/components/toast";

import type { ShellPin } from "./app-sidebar";
import { dropTargetProps, type DraggedItems } from "./drag-items";
import { submitMove } from "./files/files-move";
import { moveTrash, showUndo } from "./undo";

export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Also active on every path below this prefix. */
  matchPrefix?: string;
  /** Active only on the exact path. */
  exact?: boolean;
  /** A shorter label for the rail. */
  short?: string;
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
  short: "Drive",
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

// The rail: icon over a small label, in a 56px column.
const railItemClass =
  "relative grid w-14 justify-items-center gap-0.75 rounded-lg py-1.5 text-tab text-muted-foreground outline-none transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0";

const looks = {
  sidebar: {
    item: itemClass,
    active: "font-semibold",
    stroke: undefined,
    label: (item: WorkspaceNavItem) => item.label,
  },
  rail: {
    item: railItemClass,
    active: "text-foreground",
    stroke: 1.75,
    label: (item: WorkspaceNavItem) => item.short ?? item.label,
  },
};

const itemsLabel = (count: number) =>
  count === 1 ? "1 item" : `${count} items`;

/** Items dropped on Trash go there at once, with Undo. */
function useDropActions() {
  const refresh = useRefresh();
  const pathname = useLocation({ select: (location) => location.pathname });
  return {
    trash: async ({ items }: DraggedItems) => {
      const moved = await moveTrash(items, "trash");
      void refresh();
      showUndo({
        items: moved,
        done: "trash",
        onUndone: refresh,
      });
    },
    moveTo: async ({ items, from }: DraggedItems, folder: ShellPin) => {
      if (folder.id === from) return;
      try {
        const result = await submitMove(items, folder.id);
        const moved = items.filter((item) =>
          result.results.some((r) => r.id === item.id && r.status === "moved"),
        );
        void refresh();
        if (moved.length === 0) return;
        toastManager.add({
          title: `Moved ${itemsLabel(moved.length)} to ${folder.name}`,
          actionProps: {
            children: "Undo",
            onClick: () => void submitMove(moved, from).then(refresh),
          },
        });
      } catch (caught) {
        toastManager.add({
          title:
            caught instanceof Error
              ? caught.message
              : "Items could not be moved.",
          type: "error",
          timeout: 0,
        });
      }
    },
  };
}

/** A plain sidebar link, for items outside the main list. */
export function SidebarLink({
  item,
  rail = false,
}: {
  item: WorkspaceNavItem;
  rail?: boolean;
}) {
  const Icon = item.icon;
  const look = looks[rail ? "rail" : "sidebar"];
  return (
    <AppLink className={look.item} href={item.href}>
      <Icon aria-hidden strokeWidth={look.stroke} />
      <span className="truncate">{look.label(item)}</span>
    </AppLink>
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
  rail = false,
}: {
  items: WorkspaceNavItem[];
  label: string;
  rail?: boolean;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeHref = items.find((item) => isItemActive(pathname, item))?.href;
  const { ref, pill } = useGlidingPill<HTMLElement>(activeHref);
  const look = looks[rail ? "rail" : "sidebar"];
  const drop = useDropActions();

  return (
    <nav
      ref={ref}
      aria-label={label}
      className={cn(
        "group/nav relative flex flex-col",
        rail ? "w-14 gap-0.5" : "gap-px",
      )}
      data-ready={pill ? "" : undefined}
    >
      <GlidingPill pill={pill} />
      {items.map((item) => {
        const active = item.href === activeHref;
        const Icon = item.icon;
        return (
          <AppLink
            key={item.href}
            {...(item.href === "/trash"
              ? dropTargetProps(
                  "Move to trash",
                  (dragged) => void drop.trash(dragged),
                )
              : {})}
            aria-current={active ? "page" : undefined}
            className={cn(
              look.item,
              active && [
                look.active,
                "not-group-data-ready/nav:selected-pill hover:bg-transparent [&_svg]:text-primary",
              ],
            )}
            href={item.href}
          >
            <Icon aria-hidden strokeWidth={look.stroke} />
            <span className="truncate">{look.label(item)}</span>
          </AppLink>
        );
      })}
    </nav>
  );
}

/** Pinned favorites under the drive links, for people who turned them on. */
export function SidebarPins({ pins }: { pins: ShellPin[] }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const drop = useDropActions();
  if (pins.length === 0) return null;
  return (
    <nav aria-label="Pinned" className="flex flex-col gap-px">
      <h2 className="m-0 px-2.5 pt-2 pb-1 font-sans text-label font-medium text-muted-foreground">
        Pinned
      </h2>
      {pins.map((pin) => {
        const thumbnail = thumbnailUrlFor(pin);
        return (
          <AppLink
            {...(pin.kind === "folder"
              ? dropTargetProps(
                  `Move to ${pin.name}`,
                  (dragged) => void drop.moveTo(dragged, pin),
                )
              : {})}
            aria-current={pathname === pin.href ? "page" : undefined}
            className={cn(itemClass, "h-8 aria-[current=page]:selected-pill")}
            href={pin.href}
            key={pin.id}
          >
            {thumbnail ? (
              <img
                alt=""
                className="size-4.5 shrink-0 rounded-xs object-cover"
                src={thumbnail}
              />
            ) : (
              <ItemIcon className="size-4.5 [&_svg]:size-4" item={pin} />
            )}
            <span className="truncate">{pin.name}</span>
          </AppLink>
        );
      })}
    </nav>
  );
}
