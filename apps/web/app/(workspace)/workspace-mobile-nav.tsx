"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

import { UpdateNote, VersionButton, type ShellInfo } from "./app-sidebar";
import { NewMenu } from "./new-menu";
import { WorkspaceAvatar } from "./workspace-avatar";
import { WorkspaceStorage } from "./workspace-storage";
import { isItemActive, type WorkspaceNavItem } from "./workspace-nav";

type WorkspaceMobileNavProps = {
  info: ShellInfo;
  avatarUrl: string | null;
  initials: string;
  userLabel: string | null;
  email: string;
};

const tabItems: WorkspaceNavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/files", label: "Files", icon: FolderOpen, matchPrefix: "/files" },
  { href: "/shared", label: "Shared", icon: Share2 },
];

const moreItems: WorkspaceNavItem[] = [
  { href: "/recent", label: "Recent", icon: Clock },
  { href: "/favorites", label: "Favorites", icon: Heart },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

const tabClass =
  "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-label font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground [&_svg]:size-5 aria-[current=page]:[&_svg]:text-primary";

/** Phone tabs, the floating New button and the More sheet. */
export function WorkspaceMobileNav({
  info,
  avatarUrl,
  initials,
  userLabel,
  email,
}: WorkspaceMobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = info.isOwner
    ? [...moreItems, { href: "/admin", label: "Admin", icon: Shield }]
    : moreItems;
  const moreActive = items.some((item) => isItemActive(pathname, item));

  return (
    <>
      <NewMenu fab />
      <nav
        aria-label="Drive"
        className="fixed inset-x-0 bottom-0 z-36 grid grid-cols-4 gap-1 border-t border-border bg-card px-2 pt-1 pb-[max(6px,env(safe-area-inset-bottom))] lg:hidden"
        data-workspace-mobile-nav
      >
        {tabItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              aria-current={isItemActive(pathname, item) ? "page" : undefined}
              className={tabClass}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger
            aria-current={moreActive ? "page" : undefined}
            className={tabClass}
          >
            <MoreHorizontal aria-hidden />
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

              <div className="grid gap-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(pathname, item);
                  return (
                    <Button
                      aria-current={active ? "page" : undefined}
                      className="w-full justify-start"
                      key={item.href}
                      render={<Link href={item.href} />}
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
    </>
  );
}
