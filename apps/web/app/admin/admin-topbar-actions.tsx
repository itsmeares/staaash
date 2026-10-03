"use client";

import { useState } from "react";
import { Sun, Moon, SunMoon, LogOut, FileStack } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { applyThemeWithTransition, type Theme } from "@/lib/theme";

import { AdminAvatar } from "./admin-avatar";

interface AdminTopbarActionsProps {
  userLabel: string | null;
  email: string;
  initials: string;
  avatarUrl: string | null;
  initialTheme: Theme;
}

const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
const THEME_ICONS = { system: SunMoon, light: Sun, dark: Moon } as const;

const PROFILE_ACTION =
  "flex w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-left text-label text-foreground md:text-meta";

export function AdminTopbarActions({
  userLabel,
  email,
  initials,
  avatarUrl,
  initialTheme,
}: AdminTopbarActionsProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function handleThemeCycle() {
    const idx = THEME_CYCLE.indexOf(theme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]!;
    setTheme(next);
    applyThemeWithTransition(next);
    fetch("/api/user/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  }

  const ThemeIcon = THEME_ICONS[theme];

  return (
    <div className="flex shrink-0 items-center gap-1 md:gap-2">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={handleThemeCycle}
        title={`Theme: ${theme}`}
        aria-label={`Toggle theme (currently ${theme})`}
      >
        <ThemeIcon strokeWidth={2} aria-hidden />
      </Button>

      <Popover>
        <PopoverTrigger
          className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="Profile menu"
        >
          <AdminAvatar avatarUrl={avatarUrl} initials={initials} />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-70">
          {/* Cancels the popover's inner padding so the header runs edge to edge. */}
          <div className="-m-4 w-[calc(100%+2rem)]">
            <div className="flex flex-col items-center border-b border-hairline bg-selected px-4 pt-5 pb-4">
              <AdminAvatar
                avatarUrl={avatarUrl}
                initials={initials}
                size="lg"
                className="mb-2.5"
              />
              {userLabel && (
                <span className="text-center text-sm leading-snug font-semibold text-foreground md:text-body">
                  {userLabel}
                </span>
              )}
              <span className="mt-px text-center text-xs text-muted-foreground md:text-meta">
                {email}
              </span>
            </div>

            <div className="flex flex-col p-1.5">
              <a className={cn(PROFILE_ACTION, "hover:bg-hover")} href="/files">
                <FileStack className="size-3.5" strokeWidth={2} aria-hidden />
                Back to Drive
              </a>
            </div>

            <div className="mx-0.5 h-px bg-hairline" />

            <div className="flex flex-col p-1.5">
              <form
                action="/api/auth/sign-out"
                method="post"
                className="contents"
              >
                <input type="hidden" name="next" value="/" />
                <button
                  type="submit"
                  className={cn(
                    PROFILE_ACTION,
                    "text-destructive-foreground hover:bg-destructive/10",
                  )}
                >
                  <LogOut className="size-3.5" strokeWidth={2} aria-hidden />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
