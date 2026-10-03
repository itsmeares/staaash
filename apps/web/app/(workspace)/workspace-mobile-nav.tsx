"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  FolderOpen,
  MoreHorizontal,
  Search,
  Upload,
  Wrench,
  Settings2,
  LogOut,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

import { InstanceBadge } from "./instance-badge";
import { WorkspaceAvatar } from "./workspace-avatar";
import { WorkspaceStorage } from "./workspace-storage";
import { workspaceNavGroups, type WorkspaceNavItem } from "./workspace-nav";

type UpdateStatus =
  "up-to-date" | "update-available" | "unavailable" | "error" | null;

type WorkspaceMobileNavProps = {
  appVersion: string;
  avatarUrl: string | null;
  diskCapacityBytes: string | null;
  diskUsedBytes: string | null;
  initials: string;
  instanceName: string;
  isOwner: boolean;
  latestVersion: string | null;
  limitBytes: string | null;
  nodeVersion: string;
  repository: string | null;
  updateStatus: UpdateStatus;
  usedBytes: string;
  userLabel: string | null;
  email: string;
};

const primaryItems = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/files", label: "Files", icon: FolderOpen, matchPrefix: "/files" },
  { href: "/search", label: "Search", icon: Search },
] satisfies WorkspaceNavItem[];

const moreItems = workspaceNavGroups
  .flatMap((group) => group.items)
  .filter(
    (item) => !primaryItems.some((primary) => primary.href === item.href),
  );

const isItemActive = (pathname: string, item: WorkspaceNavItem) => {
  const prefix = item.matchPrefix ?? item.href;
  return pathname === item.href || pathname.startsWith(`${prefix}/`);
};

const navItemClass =
  "flex min-h-12.5 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 py-1 text-xs leading-none font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60 aria-expanded:bg-primary/10 aria-expanded:text-primary-ink";

function UploadButton() {
  return (
    <button
      className={navItemClass}
      type="button"
      onClick={() => window.dispatchEvent(new Event("staaash:upload-click"))}
    >
      <Upload size={18} strokeWidth={2} aria-hidden />
      <span>Upload</span>
    </button>
  );
}

export function WorkspaceMobileNav(props: WorkspaceMobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-36 grid grid-cols-5 gap-0.5 border-t border-border bg-background pt-1.75 pr-[max(8px,env(safe-area-inset-right))] pb-[max(7px,env(safe-area-inset-bottom))] pl-[max(8px,env(safe-area-inset-left))] lg:hidden md:max-lg:landscape:hidden"
      aria-label="Workspace mobile"
      data-workspace-mobile-nav
    >
      {primaryItems.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(pathname, item);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              navItemClass,
              active && "bg-primary/10 text-primary-ink",
            )}
            href={item.href}
            key={item.href}
          >
            <Icon size={18} strokeWidth={2} aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}

      <UploadButton />

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger className={navItemClass} aria-label="More">
          <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
          <span>More</span>
        </DrawerTrigger>
        <DrawerPopup showBar>
          <DrawerHeader>
            <DrawerTitle>{props.instanceName}</DrawerTitle>
          </DrawerHeader>

          <DrawerPanel className="grid gap-3">
            <div className="flex items-center gap-2.5 border-b border-hairline pb-3.5">
              <WorkspaceAvatar
                avatarUrl={props.avatarUrl}
                initials={props.initials}
              />
              <div className="grid leading-tight">
                <span className="text-label font-semibold">
                  {props.userLabel ?? props.email}
                </span>
                <span className="text-xs text-muted-foreground">
                  {props.email}
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(pathname, item);
                return (
                  <Button
                    aria-current={active ? "page" : undefined}
                    className="w-full justify-start"
                    key={item.href}
                    render={<Link href={item.href} />}
                    variant={active ? "secondary" : "ghost"}
                    onClick={() => setOpen(false)}
                  >
                    <Icon size={17} strokeWidth={1.9} aria-hidden />
                    <span>{item.label}</span>
                  </Button>
                );
              })}
            </div>

            <div className="border-t border-hairline pt-3">
              <WorkspaceStorage
                usedBytes={props.usedBytes}
                limitBytes={props.limitBytes}
                diskUsedBytes={props.diskUsedBytes}
                diskCapacityBytes={props.diskCapacityBytes}
                isAdmin={props.isOwner}
              />
            </div>

            <div className="border-t border-hairline pt-3">
              <InstanceBadge
                appVersion={props.appVersion}
                nodeVersion={props.nodeVersion}
                updateStatus={props.updateStatus}
                latestVersion={props.latestVersion}
                repository={props.repository}
                className="justify-start"
              />
            </div>

            <div className="grid gap-2 border-t border-hairline pt-3">
              <Button
                className="w-full justify-start"
                render={<Link href="/settings" />}
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                <Settings2 size={16} aria-hidden />
                Settings
              </Button>
              {props.isOwner ? (
                <Button
                  className="w-full justify-start"
                  render={<Link href="/admin" />}
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  <Wrench size={16} aria-hidden />
                  Admin
                </Button>
              ) : null}
              <form
                action="/api/auth/sign-out"
                className="contents"
                method="post"
              >
                <input type="hidden" name="next" value="/" />
                <Button
                  className="w-full justify-start"
                  type="submit"
                  variant="destructive"
                >
                  <LogOut size={16} aria-hidden />
                  Sign out
                </Button>
              </form>
            </div>
          </DrawerPanel>
        </DrawerPopup>
      </Drawer>
    </nav>
  );
}
