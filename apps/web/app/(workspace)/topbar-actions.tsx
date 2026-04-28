"use client";

import { useState, useRef } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Theme = "light" | "dark" | "system";
type UpdateStatus =
  | "up-to-date"
  | "update-available"
  | "unavailable"
  | "error"
  | null;

interface TopbarActionsProps {
  userLabel: string | null;
  username: string;
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

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  if (theme === "dark") html.classList.add("dark");
  else if (theme === "light") html.classList.add("light");
}

const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
const THEME_ICONS = { system: SunMoon, light: Sun, dark: Moon } as const;

export function TopbarActions({
  userLabel,
  username,
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
    applyTheme(next);
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
    <div className="workspace-topbar-tools">
      <button
        className="topbar-icon-btn"
        onClick={handleUploadClick}
        title="Upload files"
        aria-label="Upload files"
      >
        <Upload size={15} strokeWidth={2} aria-hidden />
        <span>Upload</span>
      </button>

      <button
        className="topbar-icon-btn"
        onClick={handleThemeCycle}
        title={`Theme: ${theme}`}
        aria-label={`Toggle theme (currently ${theme})`}
      >
        <ThemeIcon size={15} strokeWidth={2} aria-hidden />
      </button>

      <Popover>
        <PopoverTrigger
          className="topbar-icon-btn topbar-icon-btn--indicator"
          aria-label="Notifications"
        >
          <Bell size={15} strokeWidth={2} aria-hidden />
          {hasUpdate && <span className="topbar-indicator-dot" aria-hidden />}
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          className="topbar-notif-popover"
        >
          {hasUpdate ? (
            <div className="topbar-notif-item">
              <span className="topbar-notif-title">
                v{latestVersion} available
              </span>
              {releaseUrl && (
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="topbar-notif-link"
                >
                  View releases
                </a>
              )}
            </div>
          ) : (
            <p className="topbar-notif-empty">No new notifications</p>
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger
          className="workspace-avatar cursor-pointer"
          aria-label="Profile menu"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="workspace-avatar-img" />
          ) : (
            <span className="workspace-avatar-initials">{initials}</span>
          )}
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          className="!p-0 gap-0 topbar-profile-popover"
        >
          <div
            className="flex flex-col items-center px-4 pt-5 pb-4"
            style={{
              background:
                "color-mix(in oklab, var(--primary) 10%, var(--background))",
              borderBottom:
                "1px solid color-mix(in oklab, var(--foreground) 8%, transparent)",
            }}
          >
            <div
              className="workspace-avatar"
              style={{ width: 48, height: 48, marginBottom: 10 }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="workspace-avatar-img" />
              ) : (
                <span className="workspace-avatar-initials">{initials}</span>
              )}
            </div>
            {userLabel && (
              <span className="topbar-profile-card-name">{userLabel}</span>
            )}
            <span className="topbar-profile-card-username">@{username}</span>
          </div>

          <div className="flex flex-col p-1.5">
            <a
              className="topbar-profile-action flex items-center gap-2"
              href="/settings"
            >
              <Settings2 size={14} strokeWidth={2} aria-hidden />
              Settings
            </a>
            {isOwner && (
              <a
                className="topbar-profile-action flex items-center gap-2"
                href="/admin"
              >
                <Wrench size={14} strokeWidth={2} aria-hidden />
                Admin
              </a>
            )}
          </div>

          <div className="topbar-profile-divider" />

          <div className="flex flex-col p-1.5">
            <form
              action="/api/auth/sign-out"
              method="post"
              style={{ display: "contents" }}
            >
              <input type="hidden" name="next" value="/" />
              <button
                type="submit"
                className="topbar-profile-action topbar-profile-action--danger flex items-center gap-2"
              >
                <LogOut size={14} strokeWidth={2} aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
