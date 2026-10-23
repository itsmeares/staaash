import { useLocation } from "@tanstack/react-router";
import { Check, Keyboard, LogOut, Settings2, Shield } from "lucide-react";
import { AppLink } from "@/components/app-link";
import type { ReactNode } from "react";

import {
  Menu,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@staaash/ui/components/menu";

import { openShortcuts } from "./shortcuts-dialog";
import { Transfers } from "./transfers";
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
      render={<AppLink href={href} />}
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

export function TopbarActions({
  userLabel,
  email,
  initials,
  isOwner,
  avatarUrl,
}: TopbarActionsProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Transfers />

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
