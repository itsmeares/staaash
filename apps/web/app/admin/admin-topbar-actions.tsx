"use client";

import { useState } from "react";
import { Sun, Moon, SunMoon, LogOut, FileStack } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Theme = "light" | "dark" | "system";

interface AdminTopbarActionsProps {
  userLabel: string | null;
  username: string;
  initials: string;
  avatarUrl: string | null;
  initialTheme: Theme;
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  if (theme === "dark") html.classList.add("dark");
  else if (theme === "light") html.classList.add("light");
}

const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
const THEME_ICONS = { system: SunMoon, light: Sun, dark: Moon } as const;

export function AdminTopbarActions({
  userLabel,
  username,
  initials,
  avatarUrl,
  initialTheme,
}: AdminTopbarActionsProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function handleThemeCycle() {
    const idx = THEME_CYCLE.indexOf(theme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]!;
    setTheme(next);
    applyTheme(next);
    fetch("/api/user/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  }

  const ThemeIcon = THEME_ICONS[theme];

  return (
    <div className="workspace-topbar-tools">
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
              href="/files"
            >
              <FileStack size={14} strokeWidth={2} aria-hidden />
              Back to files
            </a>
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
