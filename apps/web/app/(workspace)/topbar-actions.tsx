"use client";

import {
  ArrowUpDown,
  Check,
  Keyboard,
  LogOut,
  Settings2,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";

import { openShortcuts } from "./shortcuts-dialog";
import { useTransferContext } from "./transfer-context";
import { WorkspaceAvatar } from "./workspace-avatar";
import { isAdminPath } from "./workspace-nav";

/** An app link in the menu; on its own page it only shows a check. */
function PageLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <MenuLinkItem
      aria-current={current ? "page" : undefined}
      render={<Link href={href} />}
      onClick={(event) => {
        if (current) event.preventDefault();
      }}
    >
      {children}
      {current ? (
        <span className="ms-auto flex text-primary">
          <Check aria-hidden className="size-4" />
        </span>
      ) : null}
    </MenuLinkItem>
  );
}

type TopbarActionsProps = {
  userLabel: string | null;
  email: string;
  initials: string;
  isOwner: boolean;
  avatarUrl: string | null;
};

/** Shows while files move; opens the transfer panel. */
function TransfersIndicator() {
  const { uploadingFiles, activeDownload } = useTransferContext();
  const active = uploadingFiles.filter((f) => f.status === "uploading");
  if (active.length === 0 && !activeDownload) return null;

  const total = active.reduce((sum, f) => sum + f.size, 0);
  const done = active.reduce((sum, f) => sum + f.transferredBytes, 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const label =
    active.length > 0
      ? `Uploading ${active.length} ${active.length === 1 ? "file" : "files"}, ${pct}%`
      : "Preparing a download";

  return (
    <Button
      aria-label={label}
      size="sm"
      title={label}
      variant="ghost-muted"
      onClick={() => window.dispatchEvent(new Event("staaash:transfers-open"))}
    >
      <ArrowUpDown aria-hidden />
      <span className="tabular-nums">
        {active.length > 0 ? `${pct}%` : "Zip"}
      </span>
    </Button>
  );
}

export function TopbarActions({
  userLabel,
  email,
  initials,
  isOwner,
  avatarUrl,
}: TopbarActionsProps) {
  const pathname = usePathname();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <TransfersIndicator />

      <Menu>
        <MenuTrigger
          aria-label="Profile menu"
          className="ms-1 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <WorkspaceAvatar avatarUrl={avatarUrl} initials={initials} />
        </MenuTrigger>
        <MenuPopup align="end" className="w-64">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <WorkspaceAvatar avatarUrl={avatarUrl} initials={initials} />
            <div className="grid min-w-0 leading-tight">
              {userLabel ? (
                <span className="truncate text-body font-semibold">
                  {userLabel}
                </span>
              ) : null}
              <span className="truncate text-label text-muted-foreground">
                {email}
              </span>
            </div>
          </div>
          <MenuSeparator />
          <PageLink current={pathname === "/settings"} href="/settings">
            <Settings2 aria-hidden />
            Settings
          </PageLink>
          {isOwner ? (
            <PageLink current={isAdminPath(pathname)} href="/admin">
              <Shield aria-hidden />
              Admin
            </PageLink>
          ) : null}
          <MenuItem onClick={openShortcuts}>
            <Keyboard aria-hidden />
            Keyboard shortcuts
          </MenuItem>
          <MenuSeparator />
          <form action="/api/auth/sign-out" className="contents" method="post">
            <input type="hidden" name="next" value="/" />
            <MenuItem
              className="w-full"
              nativeButton
              render={<button type="submit" />}
            >
              <LogOut aria-hidden />
              Sign out
            </MenuItem>
          </form>
        </MenuPopup>
      </Menu>
    </div>
  );
}
