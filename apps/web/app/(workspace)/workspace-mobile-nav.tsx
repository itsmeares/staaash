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

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { InstanceBadge } from "./instance-badge";
import { WorkspaceStorage } from "./workspace-storage";
import { workspaceNavGroups, type WorkspaceNavItem } from "./workspace-nav";

type UpdateStatus =
  | "up-to-date"
  | "update-available"
  | "unavailable"
  | "error"
  | null;

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
  username: string;
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

function UploadButton() {
  return (
    <button
      className="workspace-mobile-nav-item"
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
    <nav className="workspace-mobile-nav" aria-label="Workspace mobile">
      {primaryItems.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(pathname, item);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`workspace-mobile-nav-item${active ? " is-active" : ""}`}
            href={item.href}
            key={item.href}
          >
            <Icon size={18} strokeWidth={2} aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}

      <UploadButton />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className="workspace-mobile-nav-item" aria-label="More">
          <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
          <span>More</span>
        </DialogTrigger>
        <DialogContent
          className="workspace-bottom-sheet workspace-more-sheet"
          showCloseButton={false}
          onSwipeClose={() => setOpen(false)}
        >
          <div
            className="workspace-bottom-sheet-handle"
            data-bottom-sheet-drag-handle
            aria-hidden
          />
          <div className="workspace-more-head">
            <DialogTitle className="workspace-more-title">
              {props.instanceName}
            </DialogTitle>
          </div>

          <div className="workspace-more-profile">
            <span className="workspace-avatar" aria-hidden>
              {props.avatarUrl ? (
                <img
                  src={props.avatarUrl}
                  alt=""
                  className="workspace-avatar-img"
                />
              ) : (
                <span className="workspace-avatar-initials">
                  {props.initials}
                </span>
              )}
            </span>
            <div>
              <span className="workspace-more-profile-name">
                {props.userLabel ?? props.username}
              </span>
              <span className="workspace-more-profile-meta">
                @{props.username}
              </span>
            </div>
          </div>

          <div className="workspace-more-links">
            {moreItems.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(pathname, item);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`workspace-more-link${active ? " is-active" : ""}`}
                  href={item.href}
                  key={item.href}
                  onClick={() => setOpen(false)}
                >
                  <Icon size={17} strokeWidth={1.9} aria-hidden />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="workspace-more-storage">
            <WorkspaceStorage
              usedBytes={props.usedBytes}
              limitBytes={props.limitBytes}
              diskUsedBytes={props.diskUsedBytes}
              diskCapacityBytes={props.diskCapacityBytes}
              isAdmin={props.isOwner}
            />
          </div>

          <div className="workspace-more-system">
            <InstanceBadge
              appVersion={props.appVersion}
              nodeVersion={props.nodeVersion}
              updateStatus={props.updateStatus}
              latestVersion={props.latestVersion}
              repository={props.repository}
            />
          </div>

          <div className="workspace-more-actions">
            <Link
              className="workspace-more-action"
              href="/settings"
              onClick={() => setOpen(false)}
            >
              <Settings2 size={16} aria-hidden />
              Settings
            </Link>
            {props.isOwner ? (
              <Link
                className="workspace-more-action"
                href="/admin"
                onClick={() => setOpen(false)}
              >
                <Wrench size={16} aria-hidden />
                Admin
              </Link>
            ) : null}
            <form action="/api/auth/sign-out" method="post">
              <input type="hidden" name="next" value="/" />
              <button
                className="workspace-more-action workspace-more-action-danger"
                type="submit"
              >
                <LogOut size={16} aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
