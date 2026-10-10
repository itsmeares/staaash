"use client";

import {
  ArrowUpDown,
  Keyboard,
  LogOut,
  Moon,
  Settings2,
  Shield,
  Sun,
  SunMoon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
import { applyThemeWithTransition, type Theme } from "@/lib/theme";

import { openShortcuts } from "./shortcuts-dialog";
import { useTransferContext } from "./transfer-context";
import { WorkspaceAvatar } from "./workspace-avatar";

type TopbarActionsProps = {
  userLabel: string | null;
  email: string;
  initials: string;
  isOwner: boolean;
  avatarUrl: string | null;
  initialTheme: Theme;
};

const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
const THEME_ICONS = { system: SunMoon, light: Sun, dark: Moon } as const;
const THEME_LABELS = { system: "System", light: "Light", dark: "Dark" };

function saveTheme(theme: Theme) {
  applyThemeWithTransition(theme);
  fetch("/api/user/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  }).catch(() => {});
}

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
  initialTheme,
}: TopbarActionsProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const ThemeIcon = THEME_ICONS[theme];

  const changeTheme = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <TransfersIndicator />

      <Button
        aria-label={`Theme: ${THEME_LABELS[theme]}. Switch theme`}
        size="icon"
        title={`Theme: ${THEME_LABELS[theme]}`}
        variant="ghost-muted"
        onClick={() =>
          changeTheme(
            THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]!,
          )
        }
      >
        <ThemeIcon aria-hidden />
      </Button>

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
          <MenuLinkItem href="/settings">
            <Settings2 aria-hidden />
            Settings
          </MenuLinkItem>
          {isOwner ? (
            <MenuLinkItem href="/admin">
              <Shield aria-hidden />
              Admin
            </MenuLinkItem>
          ) : null}
          <MenuSub>
            <MenuSubTrigger>
              <ThemeIcon aria-hidden />
              Theme
            </MenuSubTrigger>
            <MenuSubPopup>
              <MenuRadioGroup
                value={theme}
                onValueChange={(value) => changeTheme(value as Theme)}
              >
                {THEME_CYCLE.map((option) => (
                  <MenuRadioItem key={option} value={option}>
                    {THEME_LABELS[option]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>
          <MenuItem onClick={openShortcuts}>
            <Keyboard aria-hidden />
            Keyboard shortcuts
          </MenuItem>
          <MenuSeparator />
          <form action="/api/auth/sign-out" className="contents" method="post">
            <input type="hidden" name="next" value="/" />
            <MenuItem nativeButton render={<button type="submit" />}>
              <LogOut aria-hidden />
              Sign out
            </MenuItem>
          </form>
        </MenuPopup>
      </Menu>
    </div>
  );
}
