import { useLocation } from "@tanstack/react-router";
import { AppLink } from "@/components/app-link";
import {
  Clock,
  FolderOpen,
  Heart,
  Home,
  LogOut,
  MoreHorizontal,
  Settings2,
  Share2,
  Shield,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { ItemIcon } from "@/components/file-list/file-list";
import { Button } from "@staaash/ui/components/button";
import {
  Drawer,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@staaash/ui/components/drawer";

import { UpdateNote, VersionButton, type ShellInfo } from "./app-sidebar";
import { NewTiles } from "./new-menu";
import { WorkspaceAvatar } from "./workspace-avatar";
import { WorkspaceStorage } from "./workspace-storage";
import {
  isAdminPath,
  isItemActive,
  type WorkspaceNavItem,
} from "./workspace-nav";

type WorkspaceMobileNavProps = {
  info: ShellInfo;
  avatarUrl: string | null;
  initials: string;
  userLabel: string | null;
  email: string;
};

const homeTab: WorkspaceNavItem = { href: "/home", label: "Home", icon: Home };
const filesTab: WorkspaceNavItem = {
  href: "/files",
  label: "Files",
  icon: FolderOpen,
  matchPrefix: "/files",
};
const sharedTab: WorkspaceNavItem = {
  href: "/shared",
  label: "Shared",
  icon: Share2,
};

const moreItems: WorkspaceNavItem[] = [
  { href: "/recent", label: "Recent", icon: Clock },
  { href: "/favorites", label: "Favorites", icon: Heart },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

const tabClass =
  "flex min-w-0 flex-col items-center justify-center gap-1 text-tab text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none aria-[current=page]:text-foreground [&_svg]:size-5 [&_svg]:transition-colors [&_svg]:duration-150 aria-[current=page]:[&_svg]:text-primary";

function Tab({ item, pathname }: { item: WorkspaceNavItem; pathname: string }) {
  const Icon = item.icon;
  return (
    <AppLink
      aria-current={isItemActive(pathname, item) ? "page" : undefined}
      className={tabClass}
      href={item.href}
    >
      <Icon aria-hidden strokeWidth={1.75} />
      <span>{item.label}</span>
    </AppLink>
  );
}

/** Phone tabs with the round + in the middle, and the More sheet. */
export function WorkspaceMobileNav({
  info,
  avatarUrl,
  initials,
  userLabel,
  email,
}: WorkspaceMobileNavProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [open, setOpen] = useState(false);
  const items = info.isOwner
    ? [...moreItems, { href: "/admin", label: "Admin", icon: Shield }]
    : moreItems;
  const moreActive = items.some((item) => isItemActive(pathname, item));
  // Settings pages have nothing to add to, and their save bar sits there.
  const showNew = !isAdminPath(pathname) && pathname !== "/settings";

  return (
    <nav
      aria-label="Drive"
      className="fixed inset-x-0 bottom-0 z-36 grid h-[calc(4.125rem+env(safe-area-inset-bottom))] grid-cols-[1fr_1fr_5.75rem_1fr_1fr] border-t border-border bg-background pb-[max(6px,env(safe-area-inset-bottom))] sm:hidden [body:has([data-slot=media-viewer])_&]:hidden [body:has([data-slot=phone-selection])_&]:hidden"
      data-workspace-mobile-nav
    >
      <Tab item={homeTab} pathname={pathname} />
      <Tab item={filesTab} pathname={pathname} />
      <div className="relative">
        {showNew ? (
          <NewTiles className="absolute -top-3.5 left-1/2 -ms-6.5" />
        ) : null}
      </div>
      <Tab item={sharedTab} pathname={pathname} />

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger
          aria-current={moreActive ? "page" : undefined}
          className={tabClass}
        >
          <MoreHorizontal aria-hidden strokeWidth={1.75} />
          <span>More</span>
        </DrawerTrigger>
        <DrawerPopup showBar>
          <DrawerTitle className="sr-only">More</DrawerTitle>
          <DrawerPanel className="grid gap-3 pb-4">
            <div className="flex items-center gap-2.5 px-1">
              <WorkspaceAvatar avatarUrl={avatarUrl} initials={initials} />
              <div className="grid min-w-0 leading-tight">
                <span className="truncate text-body font-semibold">
                  {userLabel ?? email}
                </span>
                <span className="truncate text-label text-muted-foreground">
                  {email}
                </span>
              </div>
            </div>

            {info.pins.length > 0 ? (
              <div className="grid gap-0.5">
                <h2 className="m-0 px-1 pb-1 font-sans text-label font-medium text-muted-foreground">
                  Pinned
                </h2>
                {info.pins.map((pin) => (
                  <Button
                    className="w-full justify-start"
                    key={pin.id}
                    render={<AppLink href={pin.href} />}
                    size="lg"
                    variant="ghost"
                    onClick={() => setOpen(false)}
                  >
                    <ItemIcon item={pin} />
                    <span className="truncate">{pin.name}</span>
                  </Button>
                ))}
              </div>
            ) : null}

            <div className="grid gap-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(pathname, item);
                return (
                  <Button
                    aria-current={active ? "page" : undefined}
                    className="w-full justify-start"
                    key={item.href}
                    render={<AppLink href={item.href} />}
                    size="lg"
                    variant={active ? "secondary" : "ghost"}
                    onClick={() => setOpen(false)}
                  >
                    <Icon aria-hidden />
                    {item.label}
                  </Button>
                );
              })}
            </div>

            <div className="grid gap-2.5 border-t border-border pt-3">
              <WorkspaceStorage
                usedBytes={info.usedBytes}
                limitBytes={info.limitBytes}
                diskUsedBytes={info.diskUsedBytes}
                diskCapacityBytes={info.diskCapacityBytes}
                isAdmin={info.isOwner}
              />
              <UpdateNote />
              <div className="flex items-center justify-between">
                <VersionButton />
                <form action="/api/auth/sign-out" method="post">
                  <input type="hidden" name="next" value="/" />
                  <Button type="submit" variant="ghost-muted">
                    <LogOut aria-hidden />
                    Sign out
                  </Button>
                </form>
              </div>
            </div>
          </DrawerPanel>
        </DrawerPopup>
      </Drawer>
    </nav>
  );
}
