"use client";

import { useState, useRef } from "react";
import { formatVersionLabel } from "@staaash/config/version";
import {
  Upload,
  Sun,
  Moon,
  SunMoon,
  Bell,
  Settings2,
  Wrench,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { applyThemeWithTransition, type Theme } from "@/lib/theme";

import { WorkspaceAvatar } from "./workspace-avatar";

type UpdateStatus =
  "up-to-date" | "update-available" | "unavailable" | "error" | null;

interface TopbarActionsProps {
  userLabel: string | null;
  email: string;
  initials: string;
  isOwner: boolean;
  avatarUrl: string | null;
  initialTheme: Theme;
  initialShowUpdateNotifications: boolean;
  initialEnableVersionChecks: boolean;
  updateStatus: UpdateStatus;
  latestVersion: string | null;
  repository: string | null;
}

const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
const THEME_ICONS = { system: SunMoon, light: Sun, dark: Moon } as const;

export function TopbarActions({
  userLabel,
  email,
  initials,
  isOwner,
  avatarUrl,
  initialTheme,
  initialShowUpdateNotifications,
  initialEnableVersionChecks,
  updateStatus,
  latestVersion,
  repository,
}: TopbarActionsProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const showUpdateNotificationsRef = useRef(initialShowUpdateNotifications);
  const enableVersionChecksRef = useRef(initialEnableVersionChecks);

  function handleUploadClick() {
    window.dispatchEvent(new Event("staaash:upload-click"));
  }

  function handleThemeCycle() {
    const idx = THEME_CYCLE.indexOf(theme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]!;
    setTheme(next);
    applyThemeWithTransition(next);
    fetch("/api/user/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: next,
        showUpdateNotifications: showUpdateNotificationsRef.current,
        enableVersionChecks: enableVersionChecksRef.current,
      }),
    }).catch(() => {});
  }

  const ThemeIcon = THEME_ICONS[theme];
  const hasUpdate = updateStatus === "update-available";
  const releaseUrl = repository
    ? `https://github.com/${repository}/releases`
    : null;

  return (
    <div className="flex shrink-0 items-center gap-1 max-xs:w-full max-xs:justify-end lg:gap-2">
      <Button
        className="lg:w-auto lg:px-3.5"
        onClick={handleUploadClick}
        size="icon"
        title="Upload files"
        aria-label="Upload files"
        variant="ghost"
      >
        <Upload size={15} strokeWidth={2} aria-hidden />
        <span className="max-lg:hidden">Upload</span>
      </Button>

      <Button
        onClick={handleThemeCycle}
        size="icon"
        title={`Theme: ${theme}`}
        aria-label={`Toggle theme (currently ${theme})`}
        variant="ghost"
      >
        <ThemeIcon size={15} strokeWidth={2} aria-hidden />
      </Button>

      <Popover>
        <PopoverTrigger
          render={<Button className="relative" size="icon" variant="ghost" />}
          aria-label="Notifications"
        >
          <Bell size={15} strokeWidth={2} aria-hidden />
          {hasUpdate && (
            <span
              className="absolute top-2.5 right-2.5 size-2 rounded-full border-2 border-background bg-destructive"
              aria-hidden
            />
          )}
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-55">
          {hasUpdate ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium lg:text-meta">
                {latestVersion
                  ? `${formatVersionLabel(latestVersion)} available`
                  : "Update available"}
              </span>
              {releaseUrl && (
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary-ink hover:underline lg:text-meta"
                >
                  View releases
                </a>
              )}
            </div>
          ) : (
            <p className="m-0 text-label text-muted-foreground lg:text-meta">
              No new notifications
            </p>
          )}
        </PopoverContent>
      </Popover>

      <Menu>
        <MenuTrigger
          className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label="Profile menu"
        >
          <WorkspaceAvatar
            avatarUrl={avatarUrl}
            initials={initials}
            className="lg:size-11"
          />
        </MenuTrigger>
        <MenuPopup align="end" className="w-70">
          <div className="mb-1 flex flex-col items-center rounded-lg bg-primary/10 px-4 pt-5 pb-4">
            <WorkspaceAvatar
              avatarUrl={avatarUrl}
              initials={initials}
              className="mb-2.5 size-12"
            />
            {userLabel && (
              <span className="text-center text-sm leading-tight font-semibold lg:text-body">
                {userLabel}
              </span>
            )}
            <span className="mt-px text-center text-xs text-muted-foreground lg:text-meta">
              {email}
            </span>
          </div>

          <MenuLinkItem href="/settings">
            <Settings2 size={14} strokeWidth={2} aria-hidden />
            Settings
          </MenuLinkItem>
          {isOwner && (
            <MenuLinkItem href="/admin">
              <Wrench size={14} strokeWidth={2} aria-hidden />
              Admin
            </MenuLinkItem>
          )}

          <MenuSeparator />

          <form action="/api/auth/sign-out" className="contents" method="post">
            <input type="hidden" name="next" value="/" />
            <MenuItem
              nativeButton
              render={<button type="submit" />}
              variant="destructive"
            >
              <LogOut size={14} strokeWidth={2} aria-hidden />
              Sign out
            </MenuItem>
          </form>
        </MenuPopup>
      </Menu>
    </div>
  );
}
